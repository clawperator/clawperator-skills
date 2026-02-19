---
name: com.coles.search-products
description: Search Coles Android app products and return structured results including current price, sale status, and original price when available.
---

Use a fresh app session (script closes then re-opens app), then collect and parse multiple UI snapshots while scrolling.

Run:

```bash
cd "$(git rev-parse --show-toplevel)"
./skills/com.coles.search-products/scripts/search_coles_products.sh
```

Optional args:

```bash
./skills/com.coles.search-products/scripts/search_coles_products.sh \
  app.actiontask.operator.development "Coke Zero"
```

Output format:

- `SEARCH|app=com.coles.android.shopmate|query=<...>|total_results=<n>`
- `RESULT|index=<n>|name=<...>|current_price=<...>|on_sale=<YES|NO>|original_price=<price|NA>`

Price semantics:

- `current_price`: parsed from visible product price text.
- `on_sale`: inferred from sale markers (`Special`) and/or a detected `Was $...` value.
- `original_price`: populated when `Was $...` is detected, otherwise `NA`.

Prerequisite:

- Ensure `adb` is installed and available on `PATH`.
