FROM fedora:36 AS build

RUN dnf install -y wget wireshark-cli nodejs chromium make gcc g++ python python-pip python-brotli

RUN groupadd -r pptruser && useradd -r -g pptruser -G audio,video,wireshark pptruser \
    && mkdir -p /home/pptruser/Downloads \
    && chown -R pptruser:pptruser /home/pptruser

# Download mitmdump
RUN mkdir mitmproxy && cd mitmproxy \
  && wget -q https://snapshots.mitmproxy.org/8.0.0/mitmproxy-8.0.0-linux.tar.gz -O mitmproxy.tar.gz \
  && tar xf mitmproxy.tar.gz && rm mitmproxy.tar.gz && cd - \
  && mkdir -p /app/bin \
  && cp /mitmproxy/* /app/bin/ \
  && chown pptruser. -R /app

RUN pip install mitmproxy==8.0.0

WORKDIR /app

USER pptruser

# Copy and install package.json first so it can be cached
COPY --chown=pptruser package*.json ./

#RUN npm i
RUN npm i --include=dev

COPY --chown=pptruser . ./

USER pptruser

# Run
# ===
FROM build AS run

ENTRYPOINT ["npm", "run", "start"]

# Test
# ====
FROM build AS test

#RUN npm i --include=dev

ENTRYPOINT ["npm", "run", "test"]