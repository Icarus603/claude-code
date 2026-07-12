import { getSettingsForSource } from '../settings/settings.js'

export function getTrustedPluginConfig(pluginId: string) {
  return {
    ...getSettingsForSource('userSettings')?.pluginConfigs?.[pluginId],
    ...getSettingsForSource('flagSettings')?.pluginConfigs?.[pluginId],
    ...getSettingsForSource('policySettings')?.pluginConfigs?.[pluginId],
  }
}
