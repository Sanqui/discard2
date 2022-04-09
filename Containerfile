FROM node:16-buster-slim AS build

RUN apt-get update \
  && echo "wireshark-common wireshark-common/install-setuid boolean true" | debconf-set-selections \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y wget \
  build-essential \
  # tshark for its post-install scripts
  tshark \
  # Wireshark dependencies
  git cmake libpcap-dev libc-ares-dev libgcrypt20-dev libglib2.0-dev flex bison libpcre2-dev libnghttp2-dev libcap-dev lua5.2-dev \
  # Chrome dependencies
  ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libgcc1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 lsb-release xdg-utils

# Build and install Wireshark (tshark) 3.6 -- we need this version

RUN git clone --depth 1 -b release-3.6 https://gitlab.com/wireshark/wireshark.git /wireshark \
  && cd /wireshark \
  && mkdir build && cd build \
  && cmake -DBUILD_wireshark=OFF ../ && make -j`nproc --ignore 2` && make install

RUN groupadd -r pptruser && useradd -r -g pptruser -G audio,video,wireshark pptruser \
    && mkdir -p /home/pptruser/Downloads \
    && chown -R pptruser:pptruser /home/pptruser

# Download mitmdump
RUN mkdir mitmproxy && cd mitmproxy \
  && wget -q https://snapshots.mitmproxy.org/7.0.4/mitmproxy-7.0.4-linux.tar.gz -O mitmproxy.tar.gz \
  && tar xf mitmproxy.tar.gz && rm mitmproxy.tar.gz && cd - \
  && mkdir -p /app/bin \
  && cp /mitmproxy/* /app/bin/ \
  && chown pptruser. -R /app

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