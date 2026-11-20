# mon-dashboard

Mod Claude Code qui garde ton tableau de bord ouvert dans un panneau à côté du chat, sans bloquer la zone de saisie.

- **Tâches Todoist** (7 jours) : cocher pour terminer, champ pour ajouter une tâche du jour.
- **Agenda Notion** du jour.
- **Mails Gmail à traiter** (même filtre que le dashboard) : « + Tâche », « Demander à Claude » (pré-remplit le chat), « Ouvrir ».
- Actualisation automatique toutes les 5 minutes, plus un bouton « Actualiser ».
- Lien vers le dashboard complet (offres, sorties, Black Friday, cadeaux).
- Commande `/mon-dashboard` pour rouvrir le panneau.

Nécessite les connecteurs Todoist, Gmail et Notion dans la session.

Installation locale : `claude --plugin-dir ./mods/mon-dashboard`
