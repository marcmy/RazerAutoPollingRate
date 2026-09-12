# CrazyLight Probe Execution Note

The approved design targets a full mouse-backend integration. During implementation in ChatGPT, the local execution container could not resolve GitHub, so branch verification is being performed through GitHub Actions instead of a local clone.

To keep edits safe and reviewable through the available repository API, the first deliverable is the complete read-only CrazyLight protocol/backend probe plus startup diagnostics. The large `src/main.js` Razer extraction is intentionally deferred until either the branch is available in a normal code workspace or hardware validation confirms the CrazyLight transport. This avoids a high-risk whole-file rewrite through a contents-only API while still making the machine ready to identify and query the arriving mouse immediately.

No CrazyLight write command, profile switch, or automatic polling-rate mutation is permitted in this phase.
