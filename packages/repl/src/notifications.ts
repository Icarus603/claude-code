// Thin alias — canonical owner is src/context/notifications.tsx. Hooks into
// AppState for the notification queue (module-level React context singleton),
// so packages/* MUST go through this alias rather than duplicating the store.
// eslint-disable-next-line no-restricted-imports
export {
  type Notification,
  useNotifications,
  getNext,
} from '@claude-code/app-host/context_v7/notifications.js'
