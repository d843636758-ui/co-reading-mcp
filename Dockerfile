FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=3100 \
    READING_MCP_DATA_DIR=/data

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates python3 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data \
    && chown node:node /data

COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node data.example ./data.example

USER node

EXPOSE 3100
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const token=process.env.MCP_AUTH_TOKEN||'';fetch('http://127.0.0.1:'+(process.env.PORT||3100)+'/health',{headers:token?{Authorization:'Bearer '+token}:{}}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "src/server-sse.js"]
