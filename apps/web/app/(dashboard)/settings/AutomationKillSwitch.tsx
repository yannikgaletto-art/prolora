'use client';

import { useEffect, useState, useTransition } from 'react';
import { Card } from '@/app/components/Card';
import { Button } from '@/app/components/Button';
import { Badge } from '@/app/components/Badge';
import { fetchApi, errorMessage } from '@/app/lib/api';

// Whole-account emergency stop (api/v1/system/automation) — not workspace
// scoped. Every Inngest function (cron and event-triggered) checks this
// flag first, so flipping it off stops all Claude/OpenAI spend and platform
// publishing within one cron tick, without a redeploy.
export function AutomationKillSwitch({ initialEnabled }: { initialEnabled: boolean | null }) {
  const [enabled, setEnabled] = useState<boolean | null>(initialEnabled);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (initialEnabled !== null) return;
    fetchApi<{ automation_enabled: boolean }>('/v1/system/automation')
      .then((data) => setEnabled(data.automation_enabled))
      .catch((err) => setError(errorMessage(err)));
  }, [initialEnabled]);

  function toggle(next: boolean) {
    setError(null);
    startTransition(async () => {
      try {
        const data = await fetchApi<{ automation_enabled: boolean }>('/v1/system/automation', {
          method: 'PATCH',
          body: JSON.stringify({ automation_enabled: next }),
        });
        setEnabled(data.automation_enabled);
      } catch (err) {
        setError(errorMessage(err));
      }
    });
  }

  return (
    <Card
      title="Automatisierung"
      description="Ein Schalter für alles, was Geld kostet: geplante Scans, KI-Auswertungen und automatisches Posten."
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Badge tone={enabled ? 'green' : 'gray'}>
            {enabled === null ? 'Lädt…' : enabled ? 'Läuft' : 'Gestoppt'}
          </Badge>
          <p className="text-sm text-gray-600">
            {enabled === null
              ? ''
              : enabled
                ? 'Cron-Jobs und Hintergrundarbeit laufen normal.'
                : 'Alle Cron-Jobs und Events brechen sofort ab, bevor sie etwas kosten.'}
          </p>
        </div>
        {enabled === false ? (
          <Button variant="primary" loading={pending} onClick={() => toggle(true)}>
            Geld ausgeben erlauben
          </Button>
        ) : (
          <Button variant="danger" loading={pending} disabled={enabled === null} onClick={() => toggle(false)}>
            Alles stoppen
          </Button>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </Card>
  );
}
