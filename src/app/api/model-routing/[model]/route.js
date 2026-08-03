import { NextResponse } from "next/server";
import {
  getModelRouteByModel,
  upsertModelRoute,
  deleteModelRoute,
  getProviderConnections,
} from "@/lib/localDb";
import { getModelInfo } from "@/sse/services/model.js";
import { resolveProviderId } from "@/shared/constants/providers";

function normalizeConnectionIds(connectionIds) {
  if (!Array.isArray(connectionIds)) return [];
  return [...new Set(connectionIds.map((id) => String(id).trim()).filter(Boolean))];
}

async function validateConnections(model, connectionIds, isActive, legacyProvider = null) {
  const ids = normalizeConnectionIds(connectionIds);
  if (isActive !== false && ids.length === 0) {
    return { error: "At least one connectionId is required for an active route" };
  }
  const modelInfo = await getModelInfo(model);
  let provider = resolveProviderId(modelInfo.provider);
  if (legacyProvider && !model.includes("/")) provider = legacyProvider;
  if (!provider) return { error: "Model must resolve to a provider" };
  const connections = await getProviderConnections();
  const selected = ids.map((id) => connections.find((connection) => connection.id === id) || null);
  if (selected.some((connection) => !connection || connection.isActive === false)) {
    return { error: "All selected connections must be active and exist" };
  }
  if (selected.some((connection) => resolveProviderId(connection.provider) !== provider)) {
    return { error: "Selected connections must match the model provider" };
  }
  return { connectionIds: ids, isActive: isActive !== false };
}

export async function GET(request, { params }) {
  try {
    const { model } = await params;
    const route = await getModelRouteByModel(decodeURIComponent(model));
    if (!route) return NextResponse.json({ error: "Model route not found" }, { status: 404 });
    return NextResponse.json(route);
  } catch (error) {
    console.log("Error fetching model route:", error);
    return NextResponse.json({ error: "Failed to fetch model route" }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  try {
    const { model: rawModel } = await params;
    const model = decodeURIComponent(rawModel);
    const existing = await getModelRouteByModel(model);
    if (!existing) return NextResponse.json({ error: "Model route not found" }, { status: 404 });
    const body = await request.json();
    const allConnections = await getProviderConnections();
    const existingProviders = existing.connectionIds
      .map((id) => allConnections.find((connection) => connection.id === id)?.provider)
      .filter(Boolean)
      .map(resolveProviderId);
    const legacyProvider = existingProviders.length > 0 && existingProviders.every((value) => value === existingProviders[0])
      ? existingProviders[0]
      : null;
    const validation = await validateConnections(model, body.connectionIds, body.isActive, legacyProvider);
    if (validation.error) return NextResponse.json({ error: validation.error }, { status: 400 });
    const route = await upsertModelRoute(model, validation.connectionIds, validation.isActive);
    return NextResponse.json(route);
  } catch (error) {
    console.log("Error updating model route:", error);
    return NextResponse.json({ error: error.message || "Failed to update model route" }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { model: rawModel } = await params;
    const deleted = await deleteModelRoute(decodeURIComponent(rawModel));
    if (!deleted) return NextResponse.json({ error: "Model route not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting model route:", error);
    return NextResponse.json({ error: "Failed to delete model route" }, { status: 500 });
  }
}
