import "@shopify/ui-extensions/preact";
import { render } from "preact";

export default async () => {
  const variantId = shopify.data?.selected?.[0]?.id;
  let variant = null;
  let errorMessage = null;

  if (variantId) {
    const { data, errors } = await shopify.query(
      `#graphql
        query ReleaseCoreBundleVariantConfiguration($id: ID!) {
          productVariant(id: $id) {
            id
            title
            requiresComponents
            productVariantComponents(first: 30) {
              nodes {
                quantity
                productVariant {
                  id
                  title
                  product {
                    id
                    title
                  }
                }
              }
            }
          }
        }
      `,
      { variables: { id: variantId } },
    );

    if (errors?.length) {
      errorMessage = errors.map((error) => error.message).filter(Boolean).join(" ");
    } else {
      variant = data?.productVariant || null;
    }
  }

  render(<Extension variant={variant} errorMessage={errorMessage} />, document.body);
};

function Extension({ variant, errorMessage }) {
  if (errorMessage) {
    return (
      <s-stack direction="block">
        <s-text>ReleaseCore could not load this bundle configuration.</s-text>
        <s-text>{errorMessage}</s-text>
      </s-stack>
    );
  }

  const components = variant?.productVariantComponents?.nodes || [];

  return (
    <s-stack direction="block">
      <s-text>Managed by ReleaseCore</s-text>
      <s-text>
        {variant?.requiresComponents
          ? `${components.length} track ${components.length === 1 ? "component" : "components"}`
          : "This variant is not currently configured as a ReleaseCore bundle."}
      </s-text>
      {components.map((component) => (
        <s-text key={`${component.productVariant.id}-${component.quantity}`}>
          {component.productVariant.product.title} × {component.quantity}
        </s-text>
      ))}
    </s-stack>
  );
}
