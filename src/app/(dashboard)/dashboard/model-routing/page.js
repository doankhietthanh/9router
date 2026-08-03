"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, Button, Modal, ModelSelectModal, Toggle } from "@/shared/components";

const EMPTY_FORM = { model: "", connectionIds: [], isActive: true };

function connectionLabel(connection) {
  return `${connection.name || connection.email || connection.id} · ${connection.provider}`;
}

export default function ModelRoutingPage() {
  const [routes, setRoutes] = useState([]);
  const [connections, setConnections] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingModel, setEditingModel] = useState(null);
  const [showRouteModal, setShowRouteModal] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  const closeRouteModal = () => {
    if (saving) return;
    setShowRouteModal(false);
    setShowModelPicker(false);
    setForm(EMPTY_FORM);
    setEditingModel(null);
  };

  const openCreateModal = () => {
    setForm(EMPTY_FORM);
    setEditingModel(null);
    setMessage(null);
    setShowRouteModal(true);
  };

  const toggleConnection = (connectionId) => {
    setForm((current) => ({
      ...current,
      connectionIds: current.connectionIds.includes(connectionId)
        ? current.connectionIds.filter((id) => id !== connectionId)
        : [...current.connectionIds, connectionId],
    }));
  };

  const saveRoute = async () => {
    if (!form.model || (form.isActive && form.connectionIds.length === 0)) return;
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
      closeRouteModal();
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
    setShowRouteModal(true);
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
    if (editingModel === route.model) closeRouteModal();
    await loadData();
  };

  const canSave = form.model && (!form.isActive || form.connectionIds.length > 0);

  return (
    <main className="p-4 lg:p-8 max-w-6xl mx-auto w-full space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-text-muted mt-1">
            Restrict a model to selected accounts. Models without a route keep the current provider-wide behavior.
          </p>
        </div>
        <Button icon="add" onClick={openCreateModal} className="w-full sm:w-auto whitespace-nowrap">
          Add Router
        </Button>
      </div>

      {message && (
        <p className={`text-sm ${message.type === "error" ? "text-red-500" : "text-emerald-600"}`}>
          {message.text}
        </p>
      )}

      {loading ? (
        <Card><p className="text-sm text-text-muted">Loading routes...</p></Card>
      ) : routes.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
              <span className="material-symbols-outlined text-[32px]">alt_route</span>
            </div>
            <p className="text-text-main font-medium mb-1">No routers yet</p>
            <p className="text-sm text-text-muted mb-4">Create a model router to restrict which accounts can be used.</p>
            <Button icon="add" onClick={openCreateModal} className="w-full sm:w-auto">
              Add Router
            </Button>
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {routes.map((route) => (
            <RouteCard
              key={route.model}
              route={route}
              onEdit={() => editRoute(route)}
              onToggle={() => toggleRoute(route)}
              onDelete={() => removeRoute(route)}
            />
          ))}
        </div>
      )}

      <Modal
        isOpen={showRouteModal}
        onClose={closeRouteModal}
        title={editingModel ? "Edit Router" : "Add Router"}
        size="lg"
      >
        <div className="space-y-5">
          <div>
            <label className="text-sm font-medium text-text-main">Model</label>
            <button
              type="button"
              disabled={!!editingModel}
              onClick={() => setShowModelPicker(true)}
              className="mt-1 flex min-h-10 w-full items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className={form.model ? "font-mono text-text-main" : "text-text-muted"}>
                {form.model || "Select a model"}
              </span>
              {!editingModel && <span className="material-symbols-outlined text-[18px] text-text-muted">unfold_more</span>}
            </button>
            {editingModel && <p className="mt-1 text-xs text-text-muted">The model cannot be changed after the route is created.</p>}
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-text-main">Allowed accounts</p>
                <p className="text-xs text-text-muted">Selected accounts are tried in the configured order.</p>
              </div>
              <span className="text-xs text-text-muted">{form.connectionIds.length} selected</span>
            </div>
            <div className="mt-2 grid max-h-[320px] gap-2 overflow-y-auto sm:grid-cols-2">
              {connections.map((connection) => (
                <label key={connection.id} className="flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-2.5 text-sm hover:bg-surface-2">
                  <input
                    type="checkbox"
                    checked={form.connectionIds.includes(connection.id)}
                    onChange={() => toggleConnection(connection.id)}
                    className="mt-1"
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-text-main">{connection.name || connection.email || connection.id}</span>
                    <span className="block truncate text-xs text-text-muted">{connection.email || connection.id}</span>
                    <span className="block text-[11px] text-text-muted">{connection.provider}</span>
                  </span>
                </label>
              ))}
            </div>
            {connections.length === 0 && <p className="mt-2 text-sm text-text-muted">No active accounts available.</p>}
          </div>

          <Toggle
            checked={form.isActive}
            onChange={(isActive) => setForm((current) => ({ ...current, isActive }))}
            label="Active route"
          />

          <div className="flex flex-col gap-2 pt-1 sm:flex-row">
            <Button onClick={closeRouteModal} variant="ghost" fullWidth size="sm">Cancel</Button>
            <Button onClick={saveRoute} fullWidth size="sm" disabled={!canSave} loading={saving}>
              {editingModel ? "Save" : "Add Router"}
            </Button>
          </div>
        </div>
      </Modal>

      {showModelPicker && (
        <ModelSelectModal
          isOpen={showModelPicker}
          onClose={() => setShowModelPicker(false)}
          onSelect={(model) => {
            setForm((current) => ({ ...current, model: model?.value || model?.name || "" }));
            setShowModelPicker(false);
          }}
          selectedModel={form.model}
          activeProviders={connections}
          title="Select Model for Router"
        />
      )}
    </main>
  );
}

function RouteCard({ route, onEdit, onToggle, onDelete }) {
  return (
    <Card padding="sm" className="group">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <span className="material-symbols-outlined text-[18px] text-primary">alt_route</span>
            </div>
            <div className="min-w-0">
              <code className="block break-all font-mono text-sm font-medium text-text-main">{route.model}</code>
              <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs ${route.isActive ? "bg-emerald-500/10 text-emerald-600" : "bg-black/5 text-text-muted"}`}>
                {route.isActive ? "Active" : "Inactive"}
              </span>
            </div>
          </div>
          <div className="flex w-full gap-2 sm:w-auto sm:shrink-0">
            <Button variant="secondary" size="sm" onClick={onEdit} className="flex-1 sm:flex-none">Edit</Button>
            <Button variant="secondary" size="sm" onClick={onToggle} className="flex-1 sm:flex-none">{route.isActive ? "Disable" : "Enable"}</Button>
            <Button variant="danger" size="sm" onClick={onDelete} className="flex-1 sm:flex-none">Delete</Button>
          </div>
        </div>

        {route.connections?.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-background text-xs uppercase tracking-wide text-text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">ID</th>
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Provider</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {route.connections.map((connection) => (
                  <tr key={connection.id}>
                    <td className="px-3 py-3 font-mono text-xs text-text-main" title={connection.id}>{connection.id}</td>
                    <td className="px-3 py-3 text-text-main">{connection.email || "—"}</td>
                    <td className="px-3 py-3 text-text-main">{connection.name || "—"}</td>
                    <td className="px-3 py-3 text-text-muted">{connection.provider || "—"}</td>
                    <td className="px-3 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${connection.isActive ? "bg-emerald-500/10 text-emerald-600" : "bg-black/5 text-text-muted"}`}>
                        {connection.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-text-muted">No usable connections</p>
        )}
        {route.invalidConnectionIds?.length > 0 && (
          <p className="text-xs text-amber-600">Stale connection IDs: {route.invalidConnectionIds.join(", ")}</p>
        )}
      </div>
    </Card>
  );
}
