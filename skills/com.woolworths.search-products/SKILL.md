---
name: com.woolworths.search-products
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
