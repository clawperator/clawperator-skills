---
name: com.coles.search-products
clawperator-skill-type: replay
description: Search for products in the Coles Android app.
---

Performs a search for a specific product query and returns top results.

## Usage

```bash
./skills/com.coles.search-products/scripts/search_coles_products.sh <device_id> [query] [operator_package]
```

Example:
```bash
./skills/com.coles.search-products/scripts/search_coles_products.sh <device_serial> "Milk"
```

## Notes

- Between steps, the script uses `wait_for_node` and bounded snapshot polling (not fixed
  sleeps) so the run finishes as soon as the UI is ready.
- The script runs a probe execution plus a second search. Cold starts can need more than
  120s wall time. If `clawperator skills run` fails with a wrapper timeout, retry with
  a higher limit, e.g. `--timeout 180000`.
