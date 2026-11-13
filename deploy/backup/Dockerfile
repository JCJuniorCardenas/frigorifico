# Servicio de backup de la base para Railway (o cualquier plataforma con Docker).
# Hace un pg_dump al arrancar y luego cada INTERVAL_SECONDS (por defecto 24 h) en /backups.
# Construir desde la raíz:  docker build -f deploy/backup/Dockerfile .
# La versión de la imagen tiene que coincidir con la del servidor Postgres (Railway: 18).
FROM postgres:18-alpine
COPY deploy/backup/backup-loop.sh /usr/local/bin/backup-loop.sh
RUN chmod +x /usr/local/bin/backup-loop.sh
ENTRYPOINT []
CMD ["/usr/local/bin/backup-loop.sh"]
