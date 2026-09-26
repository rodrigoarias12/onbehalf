# OnBehalf on Plow (1-click deploy from the Agent Index).
#
# Plow's OpenClaw base owns boot, the phone line and the Agent Index usage reporter. We add the
# agent's instructions, its scheduling skill, and the voice guard: an OpenClaw plugin shipped
# inside OpenClaw's own bundled extensions, so it is discovered, enabled and allowed to see
# conversations without any config (Plow's boot owns the plugin load paths and would drop
# anything else).
#
# Base pinned by digest: https://gallery.ecr.aws/e1h7x4a2/plow-cloud-agents
FROM public.ecr.aws/e1h7x4a2/plow-cloud-agents:base-1e73c82c4b3e0c9f76935bc0cc45061875b34aee@sha256:5f8ef7c3762b037420cd8843a767a7ab7e2433b1c8319e7cfe2ad1bdef5dee8a

ENV AGENT_ID=onbehalf
ENV AGENT_NAME="OnBehalf"
ENV AGENT_BLURB="A scheduling assistant you text. It finds times, texts the other person and books it, and it always speaks for you, never as you: a guard in the Gateway stops any message written in your voice."

COPY AGENTS.md /opt/plow/prompt/AGENTS.md
COPY skills/ /opt/plow/skills/

USER root
COPY plugin/voice-guard/ /app/dist/extensions/voice-guard/
USER node
# Index the new bundled plugin so the Gateway loads it on first boot.
RUN node /app/openclaw.mjs plugins registry --refresh || true
