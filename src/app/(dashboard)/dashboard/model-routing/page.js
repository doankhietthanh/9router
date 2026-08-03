"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/shared/components/Button";

const EMPTY_FORM = { model: "", connectionIds: [], isActive: true };

function connectionLabel(connection) {
  return `${connection.name || connection.email || connection.id} · ${connection.provider}`;
}

export default function ModelRoutingPage() {
  const [routes, setRoutes] = useState([]);
  const [connections, setConnections] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingModel, setEditingModel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [routesResponse, connectionsResponse] = await Promise.all([
        fetch("/api/model-routing", { cache: "no-store" }),
        fetch("/api/providers", { cache: "no-store" }),
      ]);
      const routesData = await routesResponse.json();
      const connectionsData = await connectionsResponse.json();
      if (!routesResponse.ok) throw new Error(routesData.error || "Failed to load model routes");
      if (!connectionsResponse.ok) throw new Error(connectionsData.error || "Failed to load connections");
      setRoutes(routesData.routes || []);
      setConnections((connectionsData.connections || []).filter((connection) => connection.isActive !== false));
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingModel(null);
  };

  const toggleConnection = (connectionId) => {
    setForm((current) => ({
      ...current,
      connectionIds: current.connectionIds.includes(connectionId)
        ? current.connectionIds.filter((id) => id !== connectionId)
        : [...current.connectionIds, connectionId],
    }));
  };

  const saveRoute = async (event) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const endpoint = editingModel
        ? `/api/model-routing/${encodeURIComponent(editingModel)}`
        : "/api/model-routing";
      const response = await fetch(endpoint, {
        method: editingModel ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to save model route");
      setMessage({ type: "success", text: editingModel ? "Model route updated" : "Model route created" });
      resetForm();
      await loadData();
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setSaving(false);
    }
  };

  const editRoute = (route) => {
    setEditingModel(route.model);
    setForm({ model: route.model, connectionIds: route.connectionIds, isActive: route.isActive });
    setMessage(null);
  };

  const toggleRoute = async (route) => {
    const response = await fetch(`/api/model-routing/${encodeURIComponent(route.model)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionIds: route.connectionIds, isActive: !route.isActive }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage({ type: "error", text: data.error || "Failed to update model route" });
      return;
    }
    await loadData();
  };

  const removeRoute = async (route) => {
    if (!window.confirm(`Delete routing for ${route.model}?`)) return;
    const response = await fetch(`/api/model-routing/${encodeURIComponent(route.model)}`, { method: "DELETE" });
    const data = await response.json();
    if (!response.ok) {
      setMessage({ type: "error", text: data.error || "Failed to delete model route" });
      return;
    }
    if (editingModel === route.model) resetForm();
    await loadData();
  };

  return (
    <main className="p-4 lg:p-8 max-w-6xl mx-auto w-full space-y-6">
      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-text-main">Restrict a model to accounts</h2>
          <p className="text-sm text-text-muted mt-1">
            Active routes only try the selected connection IDs. Models without a route keep the current provider-wide behavior.
          </p>
        </div>
        <form onSubmit={saveRoute} className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-text-main">Exact model ID</span>
            <input
              value={form.model}
              onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))}
              disabled={!!editingModel}
              placeholder="gpt-5.6-sol"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono disabled:opacity-60"
            />
          </label>
          <div>
            <span className="text-sm font-medium text-text-main">Allowed connections</span>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {connections.map((connection) => (
                <label key={connection.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.connectionIds.includes(connection.id)}
                    onChange={() => toggleConnection(connection.id)}
                  />
                  <span className="truncate" title={connection.id}>{connectionLabel(connection)}</span>
                </label>
              ))}
            </div>
            {connections.length === 0 && <p className="mt-2 text-sm text-text-muted">No active connections available.</p>}
          </div>
          <label className="flex items-center gap-2 text-sm text-text-main">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
            />
            Active route
          </label>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" loading={saving}>{editingModel ? "Update route" : "Add route"}</Button>
            {editingModel && <Button type="button" variant="secondary" onClick={resetForm}>Cancel</Button>}
          </div>
        </form>
        {message && <p className={`mt-4 text-sm ${message.type === "error" ? "text-red-500" : "text-emerald-600"}`}>{message.text}</p>}
      </section>

      <section className="rounded-xl border border-border bg-surface overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-text-main">Configured model routes</h2>
        </div>
        {loading ? (
          <p className="p-5 text-sm text-text-muted">Loading routes...</p>
        ) : routes.length === 0 ? (
          <p className="p-5 text-sm text-text-muted">No model-specific routes configured.</p>
        ) : (
          <div className="divide-y divide-border">
            {routes.map((route) => (
              <div key={route.model} className="p-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-semibold text-text-main break-all">{route.model}</code>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${route.isActive ? "bg-emerald-500/10 text-emerald-600" : "bg-black/5 text-text-muted"}`}>
                      {route.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-text-muted">
                    {route.connections?.map(connectionLabel).join(" → ") || "No usable connections"}
                  </p>
                  {route.invalidConnectionIds?.length > 0 && (
                    <p className="mt-1 text-xs text-amber-600">Stale connection IDs: {route.invalidConnectionIds.join(", ")}</p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button variant="secondary" size="sm" onClick={() => editRoute(route)}>Edit</Button>
                  <Button variant="secondary" size="sm" onClick={() => toggleRoute(route)}>{route.isActive ? "Disable" : "Enable"}</Button>
                  <Button variant="danger" size="sm" onClick={() => removeRoute(route)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
