import { NextResponse } from "next/server";
import {
  getModelRoutes,
  getModelRouteByModel,
  upsertModelRoute,
  getProviderConnections,
  getProviderConnectionById,
} from "@/lib/localDb";
import { getModelInfo } from "@/sse/services/model.js";
import { resolveProviderId } from "@/shared/constants/providers";

export const dynamic = "force-dynamic";

function normalizeModel(model) {
  return typeof model === "string" ? model.trim() : "";
}

function normalizeConnectionIds(connectionIds) {
  if (!Array.isArray(connectionIds)) return [];
  return [...new Set(connectionIds.map((id) => String(id).trim()).filter(Boolean))];
}

function safeConnection(connection) {
  if (!connection) return null;
  return {
    id: connection.id,
    provider: connection.provider,
    name: connection.displayName || connection.name || connection.email || connection.id,
    email: connection.email || null,
    isActive: connection.isActive !== false,
  };
}

async function validateRouteInput(model, connectionIds, isActive) {
  const normalizedModel = normalizeModel(model);
  const normalizedIds = normalizeConnectionIds(connectionIds);
  if (!normalizedModel) return { error: "Model is required" };
  if (isActive !== false && normalizedIds.length === 0) {
    return { error: "At least one connectionId is required for an active route" };
  }

  const modelInfo = await getModelInfo(normalizedModel);
  const provider = resolveProviderId(modelInfo.provider);
  if (!provider) return { error: "Model must resolve to a provider" };

  const connections = await Promise.all(normalizedIds.map((id) => getProviderConnectionById(id)));
  if (connections.some((connection) => !connection || connection.isActive === false)) {
    return { error: "All selected connections must be active and exist" };
  }
  if (connections.some((connection) => resolveProviderId(connection.provider) !== provider)) {
    return { error: "Selected connections must match the model provider" };
  }

  return {
    model: modelInfo.model || normalizedModel,
    connectionIds: normalizedIds,
    isActive: isActive !== false,
  };
}

async function enrichRoute(route, connections) {
  const byId = new Map(connections.map((connection) => [connection.id, connection]));
  const modelInfo = await getModelInfo(route.model);
  const provider = resolveProviderId(modelInfo.provider);
  const invalidConnectionIds = route.connectionIds.filter((id) => {
    const connection = byId.get(id);
    return !connection || connection.isActive === false || resolveProviderId(connection.provider) !== provider;
  });
  return {
    ...route,
    connections: route.connectionIds.map((id) => safeConnection(byId.get(id))).filter(Boolean),
    invalidConnectionIds,
  };
}

export async function GET() {
  try {
    const [routes, connections] = await Promise.all([getModelRoutes(), getProviderConnections()]);
    const enriched = await Promise.all(routes.map((route) => enrichRoute(route, connections)));
    return NextResponse.json({ routes: enriched });
  } catch (error) {
    console.log("Error fetching model routes:", error);
    return NextResponse.json({ error: "Failed to fetch model routes" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const validation = await validateRouteInput(body.model, body.connectionIds, body.isActive);
    if (validation.error) return NextResponse.json({ error: validation.error }, { status: 400 });

    const existing = await getModelRouteByModel(validation.model).catch(() => null);
    if (existing) return NextResponse.json({ error: "Model route already exists" }, { status: 409 });

    const route = await upsertModelRoute(validation.model, validation.connectionIds, validation.isActive);
    return NextResponse.json(route, { status: 201 });
  } catch (error) {
    console.log("Error creating model route:", error);
    return NextResponse.json({ error: error.message || "Failed to create model route" }, { status: 400 });
  }
}
