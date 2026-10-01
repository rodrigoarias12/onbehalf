# OnBehalf on Plow (1-click deploy from the Agent Index).
#
# Plow's OpenClaw base owns boot, the phone line and the Agent Index usage reporter. We add the
# agent's instructions, its scheduling skill, and the voice guard: an OpenClaw plugin shipped
# inside OpenClaw's own bundled extensions, so it is discovered, enabled and allowed to see
# conversations without any config (Plow's boot owns the plugin load paths and would drop
# anything else).
#
# Base pinned by digest: https://gallery.ecr.aws/e1h7x4a2/plow-cloud-agents
FROM public.ecr.aws/e1h7x4a2/plow-cloud-agents:base-771198a9609dcef54d44843e7da5329c17fa51b4@sha256:f1e7c421b97a80f1bd17015f96daceb965f350a241f7edc7e4d856a0e3a6f8f5

ENV AGENT_ID=onbehalf
ENV AGENT_NAME="OnBehalf"
ENV AGENT_BLURB="A scheduling assistant you text. It finds times, texts the other person and books it, and it always speaks for you, never as you: a guard in the Gateway stops any message written in your voice."

COPY AGENTS.md /opt/plow/prompt/AGENTS.md
COPY skills/ /opt/plow/skills/
COPY bin/ /opt/onbehalf/bin/
# bin/delivery.mjs shares its module with the voice guard: one reading of the delivery status.
COPY plugin/voice-guard/delivery.js /opt/onbehalf/plugin/voice-guard/delivery.js
ENV ONBEHALF_INVITES=/var/lib/plow/workspace/invites

USER root
COPY plugin/voice-guard/ /app/dist/extensions/voice-guard/
USER node
# Index the new bundled plugin so the Gateway loads it on first boot.
RUN node /app/openclaw.mjs plugins registry --refresh || true
