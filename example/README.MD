# Example

This example is a poorly made slop rendition of a UI.

**This is not meant for actual use, I am not a UI developer, and do not have the ~200 hours I would need to dedicate to this to actually create something I am proud of.**

Build your own UI, the API is public and free to use (though self-hosted is preferred). See the [API Docs](api.html) or hit the endpoints directly:

- `GET /random?n=10` - random people per category, with optional `minPageviews` / `maxPageviews` filters
- `GET /autocomplete?q=einst&limit=10` - fast prefix search
- `GET /search?q=einstein&category=humans&limit=20&offset=0` - full-text search with pagination
- `GET /health` - health check

Base URL: `https://nerdfighteria-wikipeople-795415723893.us-central1.run.app`

Rate limit: 100 requests per minute per IP.
