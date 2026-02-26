# Celio-Server

The **Celio-Server** is the backend component used by the Celio-Client to establish and manage multiplayer connections.

It is built on top of Socket.IO and provides session-based communication between players.

## Overview

The server is responsible for:

- Managing player sessions  
- Allowing players to join and leave sessions  
- Acting as a relay server to forward packets from one player to another  
- Handling reconnect timing during link phases  
- Coordinating session lifecycle events  

A session primarily acts as a transport layer between connected players.  
The server itself does not interpret gameplay data — it only ensures reliable delivery between participants.

## Architecture

- Built with Node.js  
- Uses Socket.IO for real-time communication  
- Runs as a simple HTTP server  
- Secure WebSocket (WSS) is handled externally by a reverse proxy  

## Running the Server

Start the server using Node:

    node index.ts

If running TypeScript directly:

    ts-node index.ts

## Local Development

When running locally, connections are served under:

    ws://localhost:443

In production, secure WebSocket (`wss://`) connections are expected to be terminated and handled by the hosting provider’s reverse proxy.

## Notes

- The server assumes TLS termination is handled externally.  
- It is designed purely as a relay and session coordinator.  
