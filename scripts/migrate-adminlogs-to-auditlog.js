/**
 * Migration : adminLogs (journal V1) → auditLog (journal V2.1, format AuditEntry).
 *
 *   node scripts/migrate-adminlogs-to-auditlog.js           # simulation : affiche, n'écrit rien
 *   node scripts/migrate-adminlogs-to-auditlog.js --apply   # écrit dans auditLog
 *
 * - Idempotent : chaque entrée garde un id fixe `legacy-<id adminLogs>` (relancer ne crée pas de doublon).
 * - adminLogs n'est ni modifiée ni supprimée.
 * - actor.role : rôle actuel de l'auteur ; s'il n'est plus admin (rétrogradé / supprimé), « admin »
 *   (il l'était forcément au moment de l'action).
 */
require('dotenv').config();
const { db } = require('../src/config/firebase');

const APPLY = process.argv.includes('--apply');

const ACTION_MAP = {
  approve_property: 'listing.approve',
  reject_property: 'listing.reject',
  deactivate_property: 'listing.suspend',
  reactivate_property: 'listing.restore',
  delete_property: 'listing.delete',
  activate_user: 'user.restore',
  deactivate_user: 'user.suspend',
  delete_user: 'user.delete',
  promote_landlord: 'user.update',
  demote_user: 'user.update',
};
const TARGET_MAP = { property: 'listing', user: 'user' };

(async () => {
  const snap = await db.collection('adminLogs').get();
  const actorIds = [...new Set(snap.docs.map((d) => d.data().adminId).filter(Boolean))];
  const roles = {};
  for (const id of actorIds) {
    const u = await db.collection('users').doc(id).get();
    roles[id] = u.exists && ['admin', 'proprietaire'].includes(u.data().role) ? u.data().role : 'admin';
  }

  const entries = snap.docs.map((d) => {
    const x = d.data();
    return {
      id: `legacy-${d.id}`,
      data: {
        at: x.createdAt,
        actor: { id: x.adminId || 'inconnu', name: x.adminName || 'Admin', role: roles[x.adminId] || 'admin' },
        action: ACTION_MAP[x.action] || `legacy.${x.action}`,
        targetType: TARGET_MAP[x.targetType] || x.targetType || 'inconnu',
        targetId: x.targetId || '',
        targetLabel: x.targetName || '',
        ...(x.details && { reason: x.details }),
        legacy: { source: 'adminLogs', id: d.id, action: x.action },
      },
    };
  });

  const byAction = entries.reduce((acc, e) => ({ ...acc, [e.data.action]: (acc[e.data.action] || 0) + 1 }), {});
  console.log(`${entries.length} entrée(s) adminLogs → auditLog`);
  console.log('actions :', byAction);

  if (!APPLY) {
    console.log('\nSimulation (aucune écriture). Exemple :', JSON.stringify(entries[0], null, 2));
    console.log('Relancer avec --apply pour écrire.');
    process.exit(0);
  }

  for (let i = 0; i < entries.length; i += 400) {
    const batch = db.batch();
    entries.slice(i, i + 400).forEach((e) => batch.set(db.collection('auditLog').doc(e.id), e.data));
    await batch.commit();
  }
  const migrated = await db.collection('auditLog').where('legacy.source', '==', 'adminLogs').count().get();
  console.log(`✔ Écrit. Entrées migrées présentes dans auditLog : ${migrated.data().count}`);
  process.exit(0);
})().catch((err) => { console.error('ERREUR', err.message); process.exit(1); });
