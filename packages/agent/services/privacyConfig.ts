/**
 * V7 §10.3 facade — moved to `@claude-code/config/env/privacy`.
 *
 * Wires the host's `isTelemetryDisabled` probe into the package via the
 * setter exported by the package. This file is still the call site for
 * now; once src/utils/privacyLevel.ts itself moves (Wave 2), the wiring
 * happens inside the installer.
 */

import { setIsTelemetryDisabledFn } from '@claude-code/config/env/privacy'
import { isTelemetryDisabled } from '@claude-code/config/env/privacy-level'

// eslint-disable-next-line custom-rules/no-top-level-side-effects
setIsTelemetryDisabledFn(() => isTelemetryDisabled())

export { isAnalyticsDisabled } from '@claude-code/config/env/privacy'
