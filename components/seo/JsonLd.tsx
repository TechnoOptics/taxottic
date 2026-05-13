/**
 * Server-rendered JSON-LD block.
 *
 * Renders a `<script type="application/ld+json">` with the given
 * schema.org payload inline. Used to attach structured data to the
 * marketing surface so Google can show rich results: SoftwareApplication
 * cards on the homepage, Product/Offer pricing in shopping carousels,
 * FAQ accordions under a SERP result, breadcrumbs in the URL line.
 *
 * Why a component instead of inlining: a single `<script>` tag with
 * `dangerouslySetInnerHTML` is awkward to repeat at every callsite, and
 * mistyping a schema (`@context`, `@type`, etc.) is a silent SEO bug
 * that Google's Rich Results tool will catch but a manual writer
 * won't. Centralizing here gives one place to (a) escape `</script`
 * sequences safely, (b) bump the @context if schema.org changes its
 * canonical URL, (c) audit every JSON-LD blob on the site by grepping
 * for this component.
 *
 * Usage:
 *   <JsonLd data={{ "@context": "https://schema.org", "@type": "Organization", ... }} />
 *
 * Multiple blobs on the same page are fine — each goes in its own
 * <script> tag and Google parses them independently. Don't try to
 * merge them with `@graph` unless you have a specific schema reason.
 */
type SchemaValue =
  | string
  | number
  | boolean
  | null
  | SchemaValue[]
  | { [key: string]: SchemaValue };

type Props = {
  data: { [key: string]: SchemaValue };
};

export function JsonLd({ data }: Props) {
  // Escape any `</script` that snuck into a string value. Without this,
  // a user-controlled string ending the script tag could break the page
  // and worst-case open an XSS hole. The replacement keeps the visible
  // text intact — Google still reads "</script" within a string value
  // correctly.
  const serialized = JSON.stringify(data).replace(
    /<\/script/gi,
    "<\\/script",
  );
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: serialized }}
    />
  );
}
