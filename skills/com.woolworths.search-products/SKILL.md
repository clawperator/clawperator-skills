---
name: com.woolworths.search-products
description: Search Woolworths Android app products and return structured results including current price, sale status, and original price when available.
---

Use a fresh app session (script closes then re-opens app) and parse multiple UI snapshots while scrolling.

Run:

```bash
cd "$(git rev-parse --show-toplevel)"
./skills/com.woolworths.search-products/scripts/search_woolworths_products.sh
```

Optional args:

```bash
./skills/com.woolworths.search-products/scripts/search_woolworths_products.sh \
  app.actiontask.operator.development "Coke Zero"
```

Output format:

- `SEARCH|app=com.woolworths|query=<...>|total_results=<n>`
- `RESULT|index=<n>|name=<...>|current_price=<...>|on_sale=<YES|NO>|original_price=<price|NA>`

Price semantics:

- `current_price`: parsed from product price node.
- `on_sale`: inferred from sale markers (`was`, `save`, `special`, etc.).
- `original_price`: only populated when a prior/was price is detected, otherwise `NA`.

Prerequisite:

- Ensure `adb` is installed and available on `PATH`.
