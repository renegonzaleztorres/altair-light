# Memory Footprint

**Altair Light v1.4.0**

---

## Baseline

**RSS (Resident Set Size):** ~79-82 MB
**Typical Production:** 80-100 MB under load

---

## Components

| Component | Memory Usage | Notes |
|-----------|--------------|-------|
| Node.js runtime | ~40-50 MB | V8 engine, event loop, built-ins |
| Dependencies | ~15-20 MB | Express, CORS, CleanCSS, Terser |
| Application code | ~5-10 MB | Altair module, WebApp, routes |
| DATA.json cache | <1 MB | Scales with JSON file size |
| File watcher | ~60 KB | Single fs.watch instance |

---

## Scaling

### DATA.json Impact

| JSON Size | Memory Impact | Total Memory |
|-----------|---------------|--------------|
| 1 KB | <1 KB | ~79 MB |
| 100 KB | ~200 KB | ~79 MB |
| 1 MB | ~2 MB | ~81 MB |
| 10 MB | ~20 MB | ~99 MB |

**Formula:** DATA.json memory ≈ 2× file size (due to object overhead)

### Per-Request Overhead

- **Template rendering:** ~100-500 KB temporary allocation (GC'd after response)
- **No persistent cache:** Templates processed on-demand, not stored

---

## Optimizations

**Built-in:**
- Single file watcher (not per-file)
- Atomic swap (no duplicate cache during reload)
- Debouncing (prevents reload spam)
- No template caching (trade: CPU for memory)

**Recommendations:**
- Keep DATA.json < 1 MB for optimal performance
- Use pagination for large datasets (don't load all in memory)
- Monitor RSS if serving many concurrent requests

---

## Comparison

| Framework | Baseline Memory |
|-----------|-----------------|
| **Altair Light** | ~80 MB |
| Express (minimal) | ~50 MB |
| Next.js | ~150-200 MB |
| Nest.js | ~100-120 MB |

**Context:** Altair Light's memory footprint is reasonable for a feature-complete web framework with hot-reload capability.

---

## Monitoring

**Check memory usage:**
```bash
ps aux | grep "node index.js"
# Look at RSS column (KB)
```

**Detailed info:**
```bash
node --expose-gc index.js
# In app: console.log(process.memoryUsage())
```

**Outputs:**
- `rss`: Total memory allocated
- `heapUsed`: Active JS heap
- `external`: C++ objects (buffers)

---

## Summary

✅ **Lightweight:** ~80 MB baseline
✅ **Predictable:** Scales linearly with DATA.json size
✅ **Production-ready:** Suitable for containers with 256-512 MB memory limits
✅ **Stable:** No memory leaks, proper cleanup on shutdown
