FROM node:16-buster-slim AS build

# Install Chrome dependencies
RUN apt-get update \
  && echo "wireshark-common wireshark-common/install-setuid boolean true" | debconf-set-selections \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y wget tshark \
  ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libgcc1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 lsb-release xdg-utils

RUN groupadd -r pptruser && useradd -r -g pptruser -G audio,video,wireshark pptruser \
    && mkdir -p /home/pptruser/Downloads \
    && chown -R pptruser:pptruser /home/pptruser

# Download mitmdump
RUN mkdir mitmproxy && cd mitmproxy \
  && wget -q https://snapshots.mitmproxy.org/7.0.4/mitmproxy-7.0.4-linux.tar.gz -O mitmproxy.tar.gz \
  && tar xf mitmproxy.tar.gz && rm mitmproxy.tar.gz && cd -

WORKDIR /app

COPY . .

RUN mkdir bin && cp /mitmproxy/* bin/ \
  && chown -R pptruser:pptruser /app

USER pptruser

RUN npm i

# Run
# ===
FROM build AS run

ENTRYPOINT ["npm", "run", "start"]

# Test
# ====
FROM build AS test

RUN npm i --include=dev

ENTRYPOINT ["npm", "run", "test"]