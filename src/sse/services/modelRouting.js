import { getModelRouteByModel, getProviderConnectionById } from "@/lib/localDb";
import { getProviderAlias, resolveProviderId } from "@/shared/constants/providers";

/**
 * Resolve an active exact-model route into usable connection IDs.
 * A missing/inactive route is intentionally different from an active route
 * whose connections are all stale: the latter must fail closed at runtime.
 */
export async function resolveModelConnectionRoute({ provider, model, modelKey = null }) {
  const prefixedKey = modelKey || `${getProviderAlias(resolveProviderId(provider))}/${model}`;
  const route = await getModelRouteByModel(prefixedKey) || await getModelRouteByModel(model);
  if (!route || route.isActive === false) {
    return { hasRule: false, connectionIds: null, invalidConnectionIds: [] };
  }

  const providerId = resolveProviderId(provider);
  const connectionIds = [];
  const invalidConnectionIds = [];

  for (const connectionId of route.connectionIds || []) {
    const connection = await getProviderConnectionById(connectionId);
    if (!connection || connection.isActive === false || resolveProviderId(connection.provider) !== providerId) {
      invalidConnectionIds.push(connectionId);
      continue;
    }
    connectionIds.push(connectionId);
  }

  return { hasRule: true, connectionIds, invalidConnectionIds };
}
