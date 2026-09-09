# Build the repository's ordinary image as cosigned-capacity-base first.
FROM cosigned-capacity-base
COPY src /app/src
RUN yarn build
COPY src/web/public /app/src/web/public
COPY scripts/review-web/load/server.cjs /app/scripts/review-web/load/server.cjs
ENTRYPOINT ["node", "--max-old-space-size=192", "scripts/review-web/load/server.cjs"]
