import { feature } from 'bun:bundle'

export const DESCRIPTION = 'Send a message to another agent'

export function getPrompt(): string {
  const udsRow = feature('UDS_INBOX')
    ? `\n| \`"uds:/path/to.sock"\` | Local Claude session's socket (same machine; use \`ListPeers\`) |
| \`"bridge:session_..."\` | Remote Control peer session (cross-machine; use \`ListPeers\`) |`
    : ''
  const udsSection = feature('UDS_INBOX')
    ? `\n\n## Cross-session

Use \`ListPeers\` to discover targets, then:

\`\`\`json
{"to": "uds:/tmp/cc-socks/1234.sock", "message": "check if tests pass over there"}
{"to": "bridge:session_01AbCd...", "message": "what branch are you on?"}
\`\`\`

A listed peer is alive and will process your message — no "busy" state; messages enqueue and drain at the receiver's next tool round. Your message arrives wrapped as \`<cross-session-message from="...">\`. **To reply to an incoming message, copy its \`from\` attribute as your \`to\`.**`
    : ''
  return `
# SendMessage

Send a message to another agent.

\`\`\`json
{"to": "researcher", "summary": "assign task 1", "message": "start on task #1"}
\`\`\`

| \`to\` | |
|---|---|
| \`"researcher"\` | Teammate by name |
| \`"*"\` | Broadcast to all teammates, **plain-text only**. Structured protocol messages (\`shutdown_request\`, \`plan_approval_request\`) are rejected — they carry a per-recipient \`requestId\` for response tracking, which a single broadcast cannot demultiplex. Fan out: call SendMessage once per teammate name. |${udsRow}

Your plain text output is NOT visible to other agents — to communicate, you MUST call this tool. Messages from teammates are delivered automatically; you don't check an inbox. Refer to teammates by name, never by UUID. When relaying, don't quote the original — it's already rendered to the user.${udsSection}

## Protocol responses

If you receive a JSON message with \`type: "shutdown_request"\` or \`type: "plan_approval_request"\`, respond with the matching \`_response\` type via this tool — echo the \`request_id\`, set \`approve\` true/false. Plain-text acknowledgement is NOT a response — the leader's poll only sees structured SendMessage payloads.

\`\`\`json
{"to": "team-lead", "message": {"type": "shutdown_response", "request_id": "...", "approve": true}}
{"to": "researcher", "message": {"type": "plan_approval_response", "request_id": "...", "approve": false, "feedback": "add error handling"}}
\`\`\`

Approving shutdown terminates your process. Rejecting plan sends the teammate back to revise. Don't originate \`shutdown_request\` unless asked. Don't send structured JSON status messages — use TaskUpdate.

To send the same protocol message to N teammates (e.g. shut down a whole team), call SendMessage N times — once per teammate name, each in the same model turn so they fan out in parallel. Do NOT use \`to: "*"\` for protocol messages; the tool rejects it with an explanation.
`.trim()
}
