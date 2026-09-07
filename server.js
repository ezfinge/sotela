const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static(path.join(__dirname, 'public')));

// Estrutura de dados para armazenar servidores e canais
const servers = new Map(); // serverId -> { id, name, channels: Map() }
const channels = new Map(); // channelId -> { id, name, serverId, users: Set() }

// Função para gerar IDs únicos
function generateId() {
    return crypto.randomBytes(8).toString('hex');
}

// Socket.IO - Gerenciamento de conexões
io.on('connection', (socket) => {
    console.log('Novo cliente conectado:', socket.id);

    // Criar servidor
    socket.on('create-server', (serverName) => {
        const serverId = generateId();
        const channelId = generateId();
        
        const defaultChannel = {
            id: channelId,
            name: 'geral',
            serverId: serverId,
            users: new Set()
        };
        
        const newServer = {
            id: serverId,
            name: serverName || 'Servidor',
            channels: new Map([[channelId, defaultChannel]])
        };
        
        servers.set(serverId, newServer);
        channels.set(channelId, defaultChannel);
        
        socket.emit('server-created', { serverId, serverName: newServer.name });
    });

    // Entrar em servidor
    socket.on('join-server', (serverId) => {
        const server = servers.get(serverId);
        if (server) {
            socket.join(serverId);
            socket.emit('server-info', {
                id: server.id,
                name: server.name,
                channels: Array.from(server.channels.values()).map(c => ({ id: c.id, name: c.name }))
            });
        } else {
            socket.emit('error', 'Servidor não encontrado');
        }
    });

    // Criar canal
    socket.on('create-channel', (data) => {
        const { serverId, channelName } = data;
        const server = servers.get(serverId);
        if (server) {
            const channelId = generateId();
            const newChannel = {
                id: channelId,
                name: channelName || 'novo-canal',
                serverId: serverId,
                users: new Set()
            };
            
            server.channels.set(channelId, newChannel);
            channels.set(channelId, newChannel);
            
            io.to(serverId).emit('channel-created', { id: channelId, name: newChannel.name });
        }
    });

    // Entrar em canal
    socket.on('join-channel', (data) => {
        const { channelId } = data;
        const channel = channels.get(channelId);
        if (channel) {
            socket.join(channelId);
            channel.users.add(socket.id);
            
            // Notificar outros usuários no canal
            socket.to(channelId).emit('user-joined', { userId: socket.id });
            
            // Enviar lista de usuários atuais
            const userList = Array.from(channel.users);
            socket.emit('user-list', userList);
            
            // Se houver um streamer no canal, informar novo usuário
            const existingStreamers = Array.from(channel.users).filter(id => id !== socket.id);
            if (existingStreamers.length > 0) {
                socket.emit('existing-streamers', existingStreamers);
            }
        }
    });

    // Sair do canal
    socket.on('leave-channel', (channelId) => {
        const channel = channels.get(channelId);
        if (channel) {
            channel.users.delete(socket.id);
            socket.leave(channelId);
            socket.to(channelId).emit('user-left', socket.id);
        }
    });

    // WebRTC - Sinalização
    socket.on('offer', (data) => {
        socket.to(data.channelId).emit('offer', {
            offer: data.offer,
            from: socket.id
        });
    });

    socket.on('answer', (data) => {
        socket.to(data.to).emit('answer', {
            answer: data.answer,
            from: socket.id
        });
    });

    socket.on('ice-candidate', (data) => {
        socket.to(data.to).emit('ice-candidate', {
            candidate: data.candidate,
            from: socket.id
        });
    });

    socket.on('start-stream', (data) => {
        socket.to(data.channelId).emit('stream-started', { userId: socket.id });
    });

    socket.on('stop-stream', (data) => {
        socket.to(data.channelId).emit('stream-stopped', { userId: socket.id });
    });

    // Desconectar
    socket.on('disconnect', () => {
        // Remover de todos os canais
        channels.forEach((channel, channelId) => {
            if (channel.users.has(socket.id)) {
                channel.users.delete(socket.id);
                socket.to(channelId).emit('user-left', socket.id);
            }
        });
        console.log('Cliente desconectado:', socket.id);
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
