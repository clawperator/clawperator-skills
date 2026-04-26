---
name: com.woolworths.search-products
clawperator-skill-type: replay
description: Search for products in the Woolworths Android app.
---

Performs a search for a specific product query and returns top results.

## Usage

```bash
./skills/com.woolworths.search-products/scripts/search_woolworths_products.sh <device_id> [query] [operator_package]
```

Example:
```bash
./skills/com.woolworths.search-products/scripts/search_woolworths_products.sh <device_serial> "Milk"
```

## Notes

- Between steps, the script uses `wait_for_node` and bounded snapshot polling (not fixed
  sleeps) so the run finishes as soon as the UI is ready.
