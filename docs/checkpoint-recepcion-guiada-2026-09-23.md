# Checkpoint previo a recepción guiada — 2026-09-23

Estado funcional anterior: commit `49cfe6d40fb8cb5b6879e4f2d37e4ace9a934b89`, conservado en la rama remota `backup/pre-guided-reception-20260923`. Incluye la recepción completa por WhatsApp y la resolución de referencias aproximadas dentro de una OC preparada.

Prompts activos de BuilderBot antes del ajuste: copia exacta en `C:\Users\juanr\Documents\WMS\.tmp\builderbot-pre-guided-reception-20260923.json`. La copia contiene únicamente las instrucciones de los nodos “Entrada” y “Voz”, con sus IDs y hashes. No contiene credenciales. Los dos prompts eran distintos; el ajuste guiado se inserta sin reemplazar el resto de cada uno.

La recepción guiada reutiliza `recepcion_confirmacion_borradores` con un payload versión 2 mientras se capturan datos y versión 1 cuando ya hay vista previa. No requiere migración ni modifica inventario antes de la confirmación final existente.

Si hay regresión: desde `C:\Users\juanr\Documents\WMS`, ejecutar primero `node --use-system-ca .worktrees/builderbot-idempotency/scripts/qa/apply-guided-reception-builderbot.mjs --restore --apply --reboot` para volver a los prompts exactos. Luego revertir el commit de recepción guiada en `main` y hacer push; no forzar ni resetear la rama remota. Los avances incompletos versión 2 permanecen en la tabla, pero el flujo anterior no los puede confirmar: el operario tendría que reportar la recepción completa como antes. Las vistas previas versión 1 siguen siendo compatibles.
