export function replaceExecArgTemplate(
  args: string[] | undefined,
  name: string,
  value: string,
): string[] | undefined {
  const pattern = new RegExp(`\\$\\{${name}\\}`, 'g')
  return args?.map(arg => arg.replace(pattern, () => value))
}

export function replaceExecArgUserConfig(
  args: string[] | undefined,
  options: Record<string, unknown> | undefined,
): string[] | undefined {
  return args?.map(arg =>
    arg.replace(/\$\{user_config\.([^}]+)\}/g, (_match, key: string) =>
      String(options?.[key] ?? ''),
    ),
  )
}
