'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Trash2, Plus, LogOut, BarChart2, Activity, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const CTRL = '/api/v2/telemetry/f3x9m2k8';

async function req(method: string, path: string, body?: object, token?: string) {
  const res = await fetch(`${CTRL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || `Error ${res.status}`);
  return json;
}

type EntryRow = { _id: string; email: string; role: string; createdAt: string };

function AuthScreen({ onToken }: { onToken: (t: string) => void }) {
  const [mode, setMode] = useState<'login' | 'create'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  function switchMode(next: 'login' | 'create') {
    setMode(next);
    setError('');
    setSuccess('');
    setEmail('');
    setPassword('');
    setConfirm('');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (mode === 'create' && password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (mode === 'create' && password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'login') {
        const data = await req('POST', '/open', { email, password });
        localStorage.setItem('_ct', data.access_token);
        onToken(data.access_token);
      } else {
        await req('POST', '/init', { email, password });
        setSuccess('Credentials registered.');
        switchMode('login');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const isLogin = mode === 'login';

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-1">
          <div className="flex items-center gap-2 mb-1">
            <Activity className="h-5 w-5 text-primary" />
            <CardTitle className="text-xl">Pipeline Monitor</CardTitle>
          </div>
          <CardDescription>
            {isLogin
              ? 'Internal service endpoint.'
              : 'Register service credentials. Single instance only.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex rounded-lg border p-1 gap-1">
            <button
              type="button"
              onClick={() => switchMode('login')}
              className={`flex-1 text-sm py-1.5 rounded-md transition-colors font-medium ${
                isLogin
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Connect
            </button>
            <button
              type="button"
              onClick={() => switchMode('create')}
              className={`flex-1 text-sm py-1.5 rounded-md transition-colors font-medium ${
                !isLogin
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Register
            </button>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sc-email">Email</Label>
              <Input
                id="sc-email"
                type="email"
                placeholder="account@domain.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sc-pass">Password</Label>
              <Input
                id="sc-pass"
                type="password"
                placeholder={isLogin ? '••••••••' : 'Min 8 characters'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </div>
            {!isLogin && (
              <div className="space-y-2">
                <Label htmlFor="sc-confirm">Confirm Password</Label>
                <Input
                  id="sc-confirm"
                  type="password"
                  placeholder="Re-enter password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  required
                />
              </div>
            )}

            {error && (
              <p className="text-xs text-destructive bg-destructive/10 rounded px-3 py-2">
                {error}
              </p>
            )}
            {success && (
              <p className="text-xs text-green-600 bg-green-50 dark:bg-green-950/30 dark:text-green-400 rounded px-3 py-2">
                {success}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {isLogin ? 'Connect' : 'Register'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function NewEntryForm({
  token,
  onAdded,
  onCancel,
}: {
  token: string;
  onAdded: (u: EntryRow) => void;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('operator');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const entry = await req('POST', '/add', { email, password, role }, token);
      onAdded(entry);
      setEmail('');
      setPassword('');
      setRole('operator');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="border border-border rounded-lg p-4 space-y-4 bg-muted/20">
      <p className="text-sm font-medium">New Entry</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label>Email</Label>
          <Input
            type="email"
            placeholder="user@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1">
          <Label>Password</Label>
          <Input
            type="password"
            placeholder="Min 6 characters"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1">
          <Label>Type</Label>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="operator">Operator</SelectItem>
              <SelectItem value="viewer">Viewer</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {error && (
        <p className="text-xs text-destructive bg-destructive/10 rounded px-3 py-2">{error}</p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={loading}>
          {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
          Register
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Panel({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [fetching, setFetching] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const [resetVal, setResetVal] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  const [revoking, setRevoking] = useState(false);
  const [revokeConfirm, setRevokeConfirm] = useState(false);

  const fetchEntries = useCallback(async () => {
    setFetching(true);
    try {
      const data = await req('GET', '/list', undefined, token);
      setEntries(data);
    } catch {
      onLogout();
    } finally {
      setFetching(false);
    }
  }, [token, onLogout]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  async function removeEntry(id: string) {
    setRemovingId(id);
    try {
      await req('DELETE', `/rem/${id}`, undefined, token);
      setEntries(prev => prev.filter(u => u._id !== id));
    } catch (err: any) {
      alert(err.message);
    } finally {
      setRemovingId(null);
    }
  }

  async function resetPipeline() {
    setResetting(true);
    try {
      await req('DELETE', '/flush', undefined, token);
      setResetDone(true);
      setEntries([]);
      setTimeout(() => onLogout(), 2000);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setResetting(false);
    }
  }

  async function revokeAccess() {
    setRevoking(true);
    try {
      await req('DELETE', '/exit', undefined, token);
      onLogout();
    } catch (err: any) {
      alert(err.message);
      setRevoking(false);
      setRevokeConfirm(false);
    }
  }

  const typeA = entries.filter(u => u.role === 'admin');
  const typeB = entries.filter(u => u.role !== 'admin');

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto p-6 space-y-6">

        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold tracking-tight">Pipeline Monitor</h1>
          </div>
          <Button variant="outline" size="sm" onClick={onLogout}>
            <LogOut className="h-4 w-4 mr-2" />
            Disconnect
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Total Entries', value: entries.length, icon: BarChart2 },
            { label: 'Type A', value: typeA.length, icon: Activity },
            { label: 'Type B', value: typeB.length, icon: BarChart2 },
          ].map(({ label, value, icon: Icon }) => (
            <Card key={label}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <p className="text-2xl font-bold mt-1">{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart2 className="h-4 w-4" />
                Access Entries
              </CardTitle>
              <CardDescription className="text-xs mt-0.5">
                Manage pipeline access entries and credentials.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={fetchEntries} disabled={fetching}>
                <RefreshCw className={`h-3 w-3 ${fetching ? 'animate-spin' : ''}`} />
              </Button>
              <Button size="sm" onClick={() => setShowNew(v => !v)}>
                <Plus className="h-4 w-4 mr-1" />
                {showNew ? 'Cancel' : 'New Entry'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {showNew && (
              <NewEntryForm
                token={token}
                onAdded={u => {
                  setEntries(prev => [...prev, u]);
                  setShowNew(false);
                }}
                onCancel={() => setShowNew(false)}
              />
            )}

            {fetching ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                Fetching…
              </div>
            ) : entries.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No entries.</p>
            ) : (
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 border-b">
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Email</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Type</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground hidden sm:table-cell">
                        Registered
                      </th>
                      <th className="px-4 py-2.5 w-20" />
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((u, i) => (
                      <tr
                        key={u._id}
                        className={`border-b last:border-0 ${i % 2 !== 0 ? 'bg-muted/20' : ''}`}
                      >
                        <td className="px-4 py-3 font-mono text-xs">{u.email}</td>
                        <td className="px-4 py-3">
                          <Badge
                            variant={u.role === 'admin' ? 'default' : 'secondary'}
                            className="capitalize text-xs"
                          >
                            {u.role}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                          {new Date(u.createdAt).toLocaleDateString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-7 text-xs"
                            disabled={removingId === u._id}
                            onClick={() => removeEntry(u._id)}
                          >
                            {removingId === u._id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Trash2 className="h-3 w-3" />
                            )}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-base text-destructive flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Maintenance
            </CardTitle>
            <CardDescription className="text-xs">
              System maintenance operations.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">

            <div className="rounded-lg border border-destructive/20 p-4 space-y-3">
              <div>
                <p className="text-sm font-medium">Reset Pipeline</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Clears all pipeline data and resets the service state. Cannot be undone.
                </p>
              </div>
              {resetDone ? (
                <p className="text-sm text-destructive font-medium">Reset complete.</p>
              ) : (
                <div className="flex gap-2 items-center flex-wrap">
                  <Input
                    placeholder='Type "RESET" to confirm'
                    value={resetVal}
                    onChange={e => setResetVal(e.target.value)}
                    className="max-w-[200px] h-9 text-sm font-mono"
                  />
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={resetVal !== 'RESET' || resetting}
                    onClick={resetPipeline}
                  >
                    {resetting ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Activity className="h-4 w-4 mr-2" />
                    )}
                    {resetting ? 'Processing…' : 'Reset'}
                  </Button>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-destructive/20 p-4 space-y-3">
              <div>
                <p className="text-sm font-medium">Revoke Access</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Revokes service credentials. Can be re-registered if needed.
                </p>
              </div>
              {!revokeConfirm ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                  onClick={() => setRevokeConfirm(true)}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Revoke Access
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={revoking}
                    onClick={revokeAccess}
                  >
                    {revoking ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Confirm
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRevokeConfirm(false)}
                    disabled={revoking}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>

          </CardContent>
        </Card>

      </div>
    </div>
  );
}

export default function ConsolePage() {
  const [token, setToken] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('_ct');
    if (stored) setToken(stored);
    setMounted(true);
  }, []);

  function handleLogout() {
    localStorage.removeItem('_ct');
    setToken(null);
  }

  if (!mounted) return null;
  if (!token) return <AuthScreen onToken={setToken} />;
  return <Panel token={token} onLogout={handleLogout} />;
}
