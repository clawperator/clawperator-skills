# Skill Authoring Guidelines (v0.1 PoC)

This document outlines the canonical best practices for writing Clawperator skills.

## Core Doctrine: Generic Actuator

**Clawperator is the Hand; the Agent is the Brain.**

1.  **Generic Interface:** The clawperator CLI/Node API knows nothing about specific apps. It only executes Execution JSON payloads.
2.  **External Logic:** All app-specific logic (selectors, navigation flows, data parsing) MUST live in this clawperator-skills repository.
3.  **Plain Node.js (.js):** Skills should primarily be authored in Plain Node.js (.js scripts). This ensures a lightweight, high-performance environment with zero compilation overhead.

---

## 1. The Deterministic Lifecycle (Close-Sleep-Open)

To ensure a predictable starting state, every skill MUST follow this sequence as its first set of actions:

```json
[
  { "id": "close", "type": "close_app", "params": { "applicationId": "com.example" } },
  { "id": "wait_close", "type": "sleep", "params": { "durationMs": 1500 } },
  { "id": "open", "type": "open_app", "params": { "applicationId": "com.example" } },
  { "id": "wait_open", "type": "sleep", "params": { "durationMs": 8000 } }
]
```

*   **Why Close?** Apps often cache state (previous searches, deep-linked tabs). Force-closing ensures the app starts on its true Home screen.
*   **How it works:** Because Android security restricts apps from killing other processes, the **Clawperator Node CLI** automatically intercepts close_app actions and performs a genuine adb shell am force-stop **before** dispatching the command to the device.
*   **Why the 1.5s Sleep?** Even after a force-stop, Android needs a moment to fully clean up the process before it can be reliably reopened.
*   **Why the 8s Sleep?** Modern apps (especially retail like Coles/Woolworths) are slow to initialize. Give them a generous window to avoid Node Not Found errors.

---

## 2. Navigating Decoy UI Elements

Many apps use fake UI elements on the home screen that act as triggers for the real interaction.

*   **The Search Bar Trap:** Often, the search bar on a home screen is just a TextView or Button styled to look like a field. Clicking it navigates to a new screen or opens an overlay with the real EditText.
*   **Strategy:** 
    1.  click the decoy bar (often identifiable by textContains: Search).
    2.  sleep for 1-2s.
    3.  enter_text into the real field (identifiable by role: textfield or a specific resourceId).

---

## 3. Selector Strategy

1.  **resourceId is King:** Always prefer resourceId (e.g., com.woolworths:id/search_src_text). It is the most stable selector across device locales.
2.  **textEquals for Buttons:** Use textEquals for precise matches on menu items or specific labels.
3.  **textContains as Fallback:** Use only when the text is dynamic or includes suffixes (e.g., Counter: 5).
4.  **Avoid Coordinates:** Never use raw x,y coordinates. They break across different screen resolutions and aspect ratios.

---

## 4. Node.js (.js) vs. TypeScript/Bash

While thin .sh wrappers are maintained for backward compatibility, the actual skill logic should be in a .js file using the Node.js standard library.

*   **Why .js over .ts?** TypeScript (via tsx or tsc) adds heavy dependencies and compilation lag. Plain .js runs instantly on any Node.js runtime with zero overhead, keeping Clawperator "light on the edge."
*   **Safe Payloads:** Node.js allows you to build the Execution object as a native literal and JSON.stringify() it, avoiding the escaping nightmare of sed and printf in Bash.
*   **Reliable Parsing:** The [Clawperator-Result] is a complex JSON object. Use JSON.parse() in Node to extract your data safely.
*   **Error Handling:** Node scripts can easily check the status field and error.code returned by Clawperator to provide meaningful failure messages.

---

## 5. Capturing and Parsing UI State

Use the snapshot_ui action to retrieve the full UI hierarchy for scraping or multimodal analysis.

*   **Post-Processing:** The clawperator runtime automatically retrieves snapshot text from logcat. Your skill script should look for the snapshot_ui step in the stepResults and access the data.text field.
*   **Parsing Snapshots:** Use simple regex or indexOf on the snapshot text to find data that isn't easily accessible via a single read_text call (e.g., parsing a complex list of search results).

---

## 6. Compliance and Security (Blocked Terms)

**CRITICAL:** To protect user privacy and project integrity, the following must NEVER be hardcoded in scripts or documentation:

1.  **Personal Paths:** Never include /Users/name/. Use relative paths or temporary directories.
2.  **Device Serials:** Never hardcode your physical device ID (e.g., <device_id>). Pass the device ID as a command-line argument.
3.  **PII:** Use placeholders like Person or AC_TILE_NAME for any user-specific data.

**Validation Command:**

grep -rE "Users/|<device_id_pattern>" .


---

## 7. Mandatory Metadata

Every Execution payload sent by a skill MUST include:
*   **expectedFormat**: Must be "android-ui-automator".
*   **timeoutMs**: Set a realistic timeout (e.g., 90000 for complex flows).
