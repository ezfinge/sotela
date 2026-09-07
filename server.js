const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);

// Configuração do Socket.IO
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling']
});

// Servir arquivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Rota principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Armazenamento
const servers = new Map(); // serverId -> server object
const channels = new Map(); // channelId -> channel object

function generateId() {
    return crypto.randomBytes(4).toString('hex'); // 8 caracteres
}

// Socket.IO - Gerenciamento de conexões
io.on('connection', (socket) => {
    console.log('✅ Novo cliente conectado:', socket.id);

    // CRIAR SERVIDOR
    socket.on('create-server', (serverName) => {
        console.log('🏠 Criando servidor:', serverName);
        
        const serverId = generateId();
        const channelId = generateId();
        
        // Criar canal padrão
        const defaultChannel = {
            id: channelId,
            name: 'geral',
            serverId: serverId,
            users: new Set()
        };
        
        // Criar servidor
        const newServer = {
            id: serverId,
            name: serverName || 'Servidor',
            channels: new Map([[channelId, defaultChannel]])
        };
        
        // Salvar
        servers.set(serverId, newServer);
        channels.set(channelId, defaultChannel);
        
        console.log('✅ Servidor criado:', serverId);
        console.log('📊 Total de servidores:', servers.size);
        
        // Responder ao cliente
        socket.emit('server-created', { 
            serverId: serverId, 
            serverName: newServer.name 
        });
    });

    // ENTRAR EM SERVIDOR
    socket.on('join-server', (serverId) => {
        console.log('🔍 Procurando servidor:', serverId);
        console.log('📊 Servidores disponíveis:', Array.from(servers.keys()));
        
        const server = servers.get(serverId);
        
        if (server) {
            console.log('✅ Servidor encontrado:', server.name);
            
            // Entrar na sala
            socket.join(serverId);
            socket.data.serverId = serverId;
            
            // Enviar informações do servidor
            socket.emit('server-info', {
                id: server.id,
                name: server.name,
                channels: Array.from(server.channels.values()).map(c => ({ 
                    id: c.id, 
                    name: c.name 
                }))
            });
            
            console.log('✅ Cliente entrou no servidor:', serverId);
        } else {
            console.log('❌ Servidor NÃO encontrado:', serverId);
            socket.emit('error', 'Servidor não encontrado. Verifique o ID.');
        }
    });

    // CRIAR CANAL
    socket.on('create-channel', (data) => {
        const { serverId, channelName } = data;
        console.log('➕ Criando canal:', channelName, 'no servidor:', serverId);
        
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
            
            // Notificar todos no servidor
            io.to(serverId).emit('channel-created', { 
                id: channelId, 
                name: newChannel.name 
            });
            
            console.log('✅ Canal criado:', channelId);
        } else {
            console.log('❌ Servidor não encontrado para criar canal');
        }
    });

    // ENTRAR EM CANAL
    socket.on('join-channel', (data) => {
        const { channelId } = data;
        console.log('🔗 Entrando no canal:', channelId);
        
        const channel = channels.get(channelId);
        if (channel) {
            socket.join(channelId);
            channel.users.add(socket.id);
            socket.data.channelId = channelId;
            
            // Notificar outros
            socket.to(channelId).emit('user-joined', { userId: socket.id });
            
            // Enviar lista de usuários
            const userList = Array.from(channel.users);
            socket.emit('user-list', userList);
            
            // Streamers existentes
            const existingStreamers = Array.from(channel.users).filter(
                id => id !== socket.id
            );
            if (existingStreamers.length > 0) {
                socket.emit('existing-streamers', existingStreamers);
            }
            
            console.log('✅ Entrou no canal:', channelId);
        } else {
            console.log('❌ Canal não encontrado:', channelId);
            socket.emit('error', 'Canal não encontrado');
        }
    });

    // SAIR DO CANAL
    socket.on('leave-channel', (channelId) => {
        console.log('👋 Saindo do canal:', channelId);
        const channel = channels.get(channelId);
        if (channel) {
            channel.users.delete(socket.id);
            socket.leave(channelId);
            socket.to(channelId).emit('user-left', socket.id);
        }
    });

    // WEBRTC - SINALIZAÇÃO
    socket.on('offer', (data) => {
        if (data.to) {
            socket.to(data.to).emit('offer', {
                offer: data.offer,
                from: socket.id
            });
        }
    });

    socket.on('answer', (data) => {
        if (data.to) {
            socket.to(data.to).emit('answer', {
                answer: data.answer,
                from: socket.id
            });
        }
    });

    socket.on('ice-candidate', (data) => {
        if (data.to) {
            socket.to(data.to).emit('ice-candidate', {
                candidate: data.candidate,
                from: socket.id
            });
        }
    });

    socket.on('start-stream', (data) => {
        if (data.channelId) {
            socket.to(data.channelId).emit('stream-started', { 
                userId: socket.id 
            });
        }
    });

    socket.on('stop-stream', (data) => {
        if (data.channelId) {
            socket.to(data.channelId).emit('stream-stopped', { 
                userId: socket.id 
            });
        }
    });

    // DESCONECTAR
    socket.on('disconnect', () => {
        console.log('❌ Cliente desconectado:', socket.id);
        
        // Remover de todos os canais
        channels.forEach((channel, channelId) => {
            if (channel.users.has(socket.id)) {
                channel.users.delete(socket.id);
                socket.to(channelId).emit('user-left', socket.id);
            }
        });
    });
});

// Prevenção de múltiplos listen
let isListening = false;

function startServer() {
    if (isListening) {
        console.log('⚠️ Servidor já está rodando!');
        return;
    }

    const PORT = process.env.PORT || 10000;
    
    try {
        server.listen(PORT, '0.0.0.0', () => {
            isListening = true;
            console.log('✅ Servidor rodando na porta', PORT);
            console.log('📱 Acesse: http://localhost:' + PORT);
        });

        server.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                console.error('❌ Porta', PORT, 'já está em uso!');
            } else {
                console.error('❌ Erro no servidor:', error);
            }
        });

    } catch (error) {
        console.error('❌ Erro ao iniciar servidor:', error);
    }
}

// Iniciar servidor
startServer();

// Manter ativo no Render
setInterval(() => {
    console.log('💓 Keep alive -', new Date().toISOString());
}, 300000);

// Tratamento de erros
process.on('uncaughtException', (error) => {
    console.error('❌ Erro não capturado:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('❌ Promise rejeitada:', error);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Encerrando graciosamente...');
    server.close(() => {
        console.log('✅ Servidor encerrado');
        process.exit(0);
    });
});
