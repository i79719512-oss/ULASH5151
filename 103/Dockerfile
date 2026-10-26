FROM node:24-alpine

WORKDIR /app
COPY package.json backend.js app.js app.css site-extra.css index.html icon.svg ./

ENV HOST=0.0.0.0
ENV PORT=4173
ENV NODE_ENV=production
ENV ULASH_DB_PATH=/data/ulash.sqlite
ENV ULASH_UPLOAD_DIR=/data/uploads

VOLUME ["/data"]
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "backend.js"]
