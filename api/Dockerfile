FROM python:3.12-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends ghostscript && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8090

# Migrate then serve — in the api service COMMAND (not a shared ENTRYPOINT) so
# only this service applies migrations and nothing races it (§7/§16-R5).
CMD ["sh", "-c", "alembic upgrade head && uvicorn main:app --host 0.0.0.0 --port 8090 --workers 4"]
