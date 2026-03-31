FROM polytopelabs/simplex:latest

COPY --chmod=755 entrypoint.sh /entrypoint.sh
COPY simplex.toml.template /simplex.toml.template

ENTRYPOINT ["/entrypoint.sh"]
