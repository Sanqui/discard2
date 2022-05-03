# Discard2
**Discard2** is a high fidelity archival tool for the Discord chat platform.  It supports downloading channels, threads, servers, and DMs via a command-line interface.  

## Overview
Discard2 is written in **TypeScript** using **Node.js**. It consists of two main components: the **crawler** and the **reader**. The crawler is responsible for connecting to the Discord servers and downloading the requested data into a specified directory in a format suitable for archival. It uses a **capture tool** to accomplish the task of saving the client-server traffic. The reader is responsible for reading the data from the archive and converting it to other usable formats.

### Capture tools
Discard2 supports the following capture tools:

- **none** - a dummy capture tool which does not save any data (useful only for verifying functionality)
- **mitmdump** (mitmproxy) - captures HTTP and Websocket traffic using a proxy
- **tshark** (Wireshark) - captures all traffic using packet capture.  **Not recommended**

While thark creates higher fidelity archives, due to a bug in Wireshark, it is currently not possible to reliably recover data from the packet capture.  Therefore, it's currently recommended to use the mitmdump capture tool.

## Setup
To ensure a consistent environment, it is recommended to install Discard2 as a container in Docker or Podman.  The following command will set up the `discard2` container image:

```bash
docker build -f Containerfile -t discard2 --target run .
```

By default, Discard2 creates a new directory for each job in `out/`.

Alternatively, Discard2 can be set up on a Linux system when all dependencies are installed, that being Node.js, Python, mitmproxy (in the bin/ directory), and the Python packages `brotli` and `mitmproxy`.  Please reference the [Containerfile](Containerfile) on how these dependencies are installed on Fedora Linux.

## Usage

To use Discard2 in Docker, please **prefix** all commands with the following line:

```bash
docker run --env-file=.env -v $PWD/out:/app/out:Z,U -it
```

You may replace /out with an output directory of your choosing.

### Crawler

To operate, Discard2's crawler needs to be provided with a **user account**.  Please create a `.env` file with the following contents:

```
DISCORD_EMAIL=
DISCORD_PASSWORD=
```

and fill in the email and password for the account you wish to use.  **It is currently not recommended to use your primary user account** as using any unofficial tool may result in account termination and Discard2 hasn't gone through enough testing yet.

First, it is recommended to test logging in using the following command.

```bash
npm run start -- crawler --capture-tool none --headless profile  
```

Discard2's crawler supports performing a variety of tasks.  For example, downloading all messages from the channel ID 954365219411460138 in server ID 954365197735317514 sent between 2022-01-01 and 2022-03-18, you would use:

```bash
npm run start -- crawler -c mitmproxy --headless channel 954365197735317514 954365219411460138 --after 2022-01-01 --before 2022-03-18
```

Note that Discord's date search is exclusive (so 2022-01-01 only downloads messages beginning with 2022-01-02).

Full usage of the crawler is available under `crawler --help`:

```
Usage: discard2 crawler [options] [command]

Start or resume a crawling job

Options:
  -h, --help                                             display help for command

Commands:
  profile [options]                                      Log in and fetch profile information
  dm [options] <dm-id>                                   Download a single DM
  servers [options]                                      Download all servers
  server [options] <server-id>                           Download a single server
  channel [options] <server-id> <channel-id>             Download a single channel
  thread [options] <server-id> <channel-id> <thread-id>  Download a single thread
  resume [options] <path>                                Resume an interrupted job
```

**Note**: To use the the `tshark` capture tool with Docker, you may have to add `--cap-add=NET_RAW --cap-add=NET_ADMIN` to your Docker command.  This is not necessary with Podman.

**Warning:**  When you use the `tshark` capture tool outside of a container, **all** (possibly sensitive) traffic on your system gets saved.  Only use this capture tool without a container for testing purposes, never publish the resulting captures.

### Reader

To convert captures into JSONL suitable for further processing, use:

```bash
npm run --silent start -- reader -f jsonl $JOB_DIRECTORY > out.jsonl
```

In order to import data into a running ElasticSearch instance, the following command should do the trick:

```bash
npm run --silent start -- reader -f elasticsearch $JOB_DIRECTORY | curl --cacert $ELASTICSEARCH_CRT -u elastic:$ELASTICSEARCH_PASS -s -H "Content-Type: application/x-ndjson" -XPOST https://$ELASTICSEARCH_HOST/_bulk --data-binary @-; echo
```

The currently supported output formats are:

- `print` - plain text overview of requests and responses
- `jsonl` - machine readable JSON lines with full request and response data
- `elasticsearch` - message data in format for import to an Elasticsearch index
` `derive-urls` - URLs of images and attachments for archival by other tools.


## Running tests

```bash
npm t
```

Or in Docker/Podman:

```bash
docker build -f Containerfile -t discard2-test --target test .
docker run --cap-add=NET_RAW --cap-add=NET_ADMIN  discard2-test
```

## FAQ

**Q:** Why is the account password included in the job state file?

A: Because it is also included in the capture and cannot be removed unless you derive the capture.  This way it is more obvious.
