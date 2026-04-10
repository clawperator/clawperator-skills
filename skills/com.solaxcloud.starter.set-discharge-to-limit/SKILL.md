---
name: com.solaxcloud.starter.set-discharge-to-limit
description: |-
  Deprecated compatibility shim for the replay discharge-to-limit skill.
---

Deprecated compatibility shim for `com.solaxcloud.starter.set-discharge-to-limit-replay`.

This unsuffixed skill id is being kept temporarily so existing callers do not
break while the Solax proving case is split into:

- `com.solaxcloud.starter.set-discharge-to-limit-replay`
- `com.solaxcloud.starter.set-discharge-to-limit-orchestrated` (planned)

New callers should use `com.solaxcloud.starter.set-discharge-to-limit-replay`.

Arguments:

- first positional arg after the device id: target percentage as an integer
  from `0` to `100`

Run through the wrapper:

```bash
clawperator skills run com.solaxcloud.starter.set-discharge-to-limit-replay --device <device_serial> --operator-package com.clawperator.operator.dev -- 40
```

Direct local invocation:

```bash
DEVICE_ID=<device_serial> CLAWPERATOR_OPERATOR_PACKAGE=com.clawperator.operator.dev node skills/com.solaxcloud.starter.set-discharge-to-limit-replay/scripts/run.js <device_serial> 40
```

This shim delegates to the replay skill implementation so the current exact-id
lookup keeps working during the migration.
