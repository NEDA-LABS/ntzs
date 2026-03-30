FROM ghcr.io/polytope-labs/simplex:latest

COPY entrypoint.sh /entrypoint.sh
COPY simplex.toml.template /simplex.toml.template

RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
