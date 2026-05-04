// PushNotification tool — prompt and description copied from upstream
// v2.1.123 (resplit/2540.js: Lh9, kh9). Self-host port omits ant-cloud
// references; the upstream wording happens to be cloud-neutral so no
// rewriting is needed.

export const PUSH_NOTIFICATION_TOOL_NAME = 'PushNotification'

export const DESCRIPTION =
  'Send a notification to the user via their terminal and, when Remote Control is connected, also push to their mobile device'

export const PROMPT = `This tool sends a desktop notification in the user's terminal. If Remote Control is connected, it also pushes to their phone. Either way, it pulls their attention from whatever they're doing — a meeting, another task, dinner — to this session. That's the cost. The benefit is they learn something now that they'd want to know now: a long task finished while they were away, a build is ready, you've hit something that needs their decision before you can continue.

Because a notification they didn't need is annoying in a way that accumulates, err toward not sending one. Don't notify for routine progress, or to announce you've answered something they asked seconds ago and are clearly still watching, or when a quick task completes. Notify when there's a real chance they've walked away and there's something worth coming back for — or when they've explicitly asked you to notify them.

Keep the message under 200 characters, one line, no markdown. Lead with what they'd act on — "build failed: 2 auth tests" tells them more than "task done" and more than a status dump.

If the result says the push wasn't sent, that's expected — no action needed.`
