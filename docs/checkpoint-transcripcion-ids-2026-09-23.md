# Checkpoint anterior al ajuste de IDs transcritos

- Código anterior: `bcebd1f`, preservado en la rama remota `backup/pre-ocid-transcription-20260923`.
- Instrucciones exactas anteriores de los nodos BuilderBot “Entrada” y “Voz”: `C:\Users\juanr\Documents\WMS\.tmp\builderbot-pre-ocid-transcription-20260923.json`. No contiene credenciales.
- El ajuste no requiere migración ni cambia inventario.

Para regresar, desde `C:\Users\juanr\Documents\WMS` ejecuta primero `node --use-system-ca .worktrees/builderbot-idempotency/scripts/qa/apply-transcription-ids-builderbot.mjs --restore --apply --reboot`. Después revierte en `main` el commit del ajuste de IDs y haz push; no fuerces ni resetees la rama remota. La restauración de BuilderBot compara los prompts con el checkpoint y se niega a sobrescribir cambios posteriores ajenos.
