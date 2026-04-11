---
name: com.solaxcloud.starter.set-discharge-to-limit
clawperator-skill-type: replay
description: |-
  Deprecated compatibility shim for the SolaX replay baseline skill. Delegates to com.solaxcloud.starter.set-discharge-to-limit-replay.
---

Deprecated compatibility shim for the old unsuffixed SolaX discharge-limit skill id.

Compatibility decision:

- this unsuffixed id remains available temporarily so existing callers do not break immediately
- the shim delegates directly to `com.solaxcloud.starter.set-discharge-to-limit-replay`
- new callers should switch to `com.solaxcloud.starter.set-discharge-to-limit-replay`

Behavior:

- forwards all arguments to the replay baseline implementation
- preserves the replay skill exit code
- preserves stdout and stderr from the replay skill

Preferred replacement:

```bash
node /Users/admin/src/clawperator/apps/node/dist/cli/index.js skills run com.solaxcloud.starter.set-discharge-to-limit-replay --device <device_serial> --json -- 40
```

Legacy compatibility path:

```bash
node /Users/admin/src/clawperator/apps/node/dist/cli/index.js skills run com.solaxcloud.starter.set-discharge-to-limit --device <device_serial> --json -- 40
```
