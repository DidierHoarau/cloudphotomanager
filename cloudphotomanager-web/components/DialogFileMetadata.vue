<template>
  <div class="dialog-overlay" @click.self="clickedClose()">
    <article class="dialog-article">
      <header>
        <a
          href="#close"
          aria-label="Close"
          class="close"
          @click.prevent="clickedClose()"
        ></a>
        File Metadata
      </header>
      <table class="dialog-info-table">
        <tbody>
          <tr>
            <td class="dialog-info-label">Name</td>
            <td>{{ file.filename }}</td>
          </tr>
          <tr>
            <td class="dialog-info-label">GPS</td>
            <td>
              <template v-if="gps">
                <strong
                  >{{ gps.lat.toFixed(6) }}, {{ gps.lon.toFixed(6) }}</strong
                >
                <a
                  :href="`https://www.openstreetmap.org/?mlat=${gps.lat}&mlon=${gps.lon}#map=15/${gps.lat}/${gps.lon}`"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="dialog-metadata-maplink"
                >
                  Open in OpenStreetMap
                </a>
              </template>
              <em v-else class="dialog-metadata-missing">
                No GPS data on this file
              </em>
            </td>
          </tr>
        </tbody>
      </table>

      <hr />
      <strong>info</strong>
      <pre class="dialog-metadata-yaml">{{ infoYaml }}</pre>

      <hr />
      <strong>metadata</strong>
      <pre class="dialog-metadata-yaml">{{ metadataYaml }}</pre>
    </article>
  </div>
</template>

<script>
// Minimal client-side YAML serializer. Avoids adding a dependency for what
// is just a debug-display feature. Handles objects, arrays, primitives,
// Date objects and Buffer-like JSON ({ type: 'Buffer', data: [...] }).
function yamlStringifyScalar(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (Number.isFinite(value)) return String(value);
    return ".nan";
  }
  if (value instanceof Date) return value.toISOString();
  // Strings: quote when needed (special chars, leading/trailing space,
  // looks-like-number/bool/null, contains characters that would break
  // bare-scalar parsing).
  const s = String(value);
  if (s === "") return '""';
  const needsQuote =
    /[:#&*!|>'"%@`\n\r\t]/.test(s) ||
    /^[\s-?]/.test(s) ||
    /\s$/.test(s) ||
    /^(true|false|null|~|-?\d)/i.test(s);
  if (!needsQuote) return s;
  return JSON.stringify(s);
}

function yamlStringify(value, indent = 0) {
  const pad = "  ".repeat(indent);
  if (
    value === null ||
    value === undefined ||
    typeof value !== "object" ||
    value instanceof Date
  ) {
    return yamlStringifyScalar(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value
      .map((item) => {
        if (
          item !== null &&
          typeof item === "object" &&
          !(item instanceof Date)
        ) {
          const nested = yamlStringify(item, indent + 1);
          // Bring the first line up next to the dash, indent the rest.
          const lines = nested.split("\n");
          return `${pad}- ${lines[0].trimStart()}${
            lines.length > 1 ? "\n" + lines.slice(1).join("\n") : ""
          }`;
        }
        return `${pad}- ${yamlStringifyScalar(item)}`;
      })
      .join("\n");
  }
  // Plain object
  const keys = Object.keys(value);
  if (keys.length === 0) return "{}";
  return keys
    .map((key) => {
      const v = value[key];
      const safeKey = /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)
        ? key
        : JSON.stringify(key);
      if (v !== null && typeof v === "object" && !(v instanceof Date)) {
        if (Array.isArray(v) && v.length === 0) return `${pad}${safeKey}: []`;
        if (!Array.isArray(v) && Object.keys(v).length === 0)
          return `${pad}${safeKey}: {}`;
        return `${pad}${safeKey}:\n${yamlStringify(v, indent + 1)}`;
      }
      return `${pad}${safeKey}: ${yamlStringifyScalar(v)}`;
    })
    .join("\n");
}

export default {
  props: {
    file: {
      type: Object,
      required: true,
    },
  },
  computed: {
    // Mirrors the server-side extraction in SearchGeoSql.ts:
    // info.exif.GPSInfo.{GPSLatitude,GPSLongitude} stored by
    // exif-reader v2 as DMS arrays [degrees, minutes, seconds],
    // with sign from GPSLatitudeRef / GPSLongitudeRef.
    gps() {
      const g = this.file?.info?.exif?.GPSInfo;
      if (!g) return null;
      const toDecimal = (v) => {
        if (typeof v === "number" && Number.isFinite(v)) return v;
        if (
          Array.isArray(v) &&
          v.length >= 3 &&
          typeof v[0] === "number" &&
          typeof v[1] === "number" &&
          typeof v[2] === "number"
        ) {
          return v[0] + v[1] / 60 + v[2] / 3600;
        }
        return null;
      };
      const rawLat = toDecimal(g.GPSLatitude);
      const rawLon = toDecimal(g.GPSLongitude);
      if (rawLat === null || rawLon === null) return null;
      const lat = g.GPSLatitudeRef === "S" ? -rawLat : rawLat;
      const lon = g.GPSLongitudeRef === "W" ? -rawLon : rawLon;
      return { lat, lon };
    },
    infoYaml() {
      try {
        return yamlStringify(this.file?.info ?? null);
      } catch (_) {
        return String(this.file?.info);
      }
    },
    metadataYaml() {
      try {
        return yamlStringify(this.file?.metadata ?? null);
      } catch (_) {
        return String(this.file?.metadata);
      }
    },
  },
  methods: {
    clickedClose() {
      this.$emit("onClose");
    },
  },
};
</script>

<style scoped>
.dialog-metadata-maplink {
  margin-left: 0.5em;
  font-size: 0.9em;
}
.dialog-metadata-missing {
  opacity: 0.6;
}
.dialog-metadata-yaml {
  max-height: 30vh;
  overflow: auto;
  white-space: pre;
  text-align: left;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.8em;
  line-height: 1.4;
  padding: 0.6em 0.8em;
  margin: 0.4em 0;
  background: #1118;
  color: #eee;
  border-radius: 4px;
}
</style>
