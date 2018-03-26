require('colors');

const
	express = require('express'),
	app = express(),
	http = require('http').createServer(app),
	io = require('socket.io')(http),
	redis = require("redis"),
	client = redis.createClient(),
	requestIp = require('request-ip');

function consoleLog(event, method, msg = undefined) {
	console.log(event.red + '.' + method.yellow + (msg !== undefined ? (' => ' + msg) : ''));
}

app.get('/', (req, res) => {
	res.sendFile(`${__dirname}/index.html`);
});

app.use('/assets', express.static(__dirname + '/assets'));

io.on('connection', (socket) => {
	consoleLog('socket', 'connection', 'socket opened');
	
	client.sadd('channels', "general");
	
	client.sadd('channels', "testRoom");
	
	// Utilisateur lance une fenêtre de chat
	socket.on('chat.join', (username) => {
		
		// Sauvegarder les données dans le socket
		socket.ip = requestIp.getClientIp(socket.request);
		socket.username = username;
		socket.channel = 'general';
		
		consoleLog('chat', 'join', `[${socket.username}]`.bold + ' join channel with IP ' + `${socket.ip}`.yellow);
		
		// Rejoindre le channel de base
		socket.join(socket.channel);
		
		const json = JSON.stringify({username: socket.username});
		
		// Ajouter l'utilisateur dans les utilisateurs connectés
		client.sadd('users', socket.username);
		
		// Ajouter l'utilisateur à la liste de la salle
		client.sadd(`users:${socket.channel}`, socket.username);
		
		// Le retiré des utilisateurs déconnectés
		client.srem('disconnectedUsers', socket.username);
		
		// Mettre à jour les listes côté front
		client.smembers('disconnectedUsers', (err, data) =>{
			io.emit("chat.disconnectedUserList", data);
		});
		client.smembers('users', (err, data) =>{
			io.emit("chat.userList", data);
		});
		
		// Récupéré tout les messages de la salle de base
		client.lrange(`messages:${socket.channel}`, 0, 4, (err, messagesData) => {
			console.log(messagesData);
			socket.emit('channel.initMessages', messagesData);
		});
		
		// Récupéré tout les utilisateurs de la salle de base
		client.smembers(`users:${socket.channel}`, (err, usersData) => {
			io.in(socket.channel).emit('channel.initUsers', usersData);
		});
		
		// Récupéré la liste des salles
		client.smembers('channels', (err, channels) => {
			socket.emit('chat.channelList', channels);
		});
		
		socket.emit('channel.initName', socket.channel);
	});
	
	// Ajouter le message à la salle dans laquelle l'utilisateur est connecté
	socket.on('channel.message', (message) => {
		consoleLog('chat', 'newMessage', ('[' + socket.username + ']').bold + ` send to channel "${socket.channel}" the message "${message}"`);
		
		const messageData = JSON.stringify({username: socket.username, message: message});
		
		client.lpush(`messages:${socket.channel}`, messageData, (err, reply) => {
		});
		
		io.in(socket.channel).emit('channel.newMessage', messageData);
	});
	
	// Changer de salle de chat
	socket.on('chat.joinChannel', (channel) => {
		
		// Retirer l'utilisateur de la salle précèdente
		client.srem(`users:${socket.channel}`, socket.username);
		
		socket.leave(socket.channel, () => {
			socket.join(channel);
			consoleLog('chatroom', 'joinChannel', `${socket.username} leave channel "${socket.channel}" and join channel "${channel}".`);
			
			socket.channel = channel;
			
			// Emettre un message aux utilisateurs de la salle nouvel utilisateurs
			socket.to(socket.channel).emit('channel.userJoined', socket.username);
			
			// Ajouter l'utilisateur à la liste de la salle
			client.sadd(`users:${socket.channel}`, socket.username);
			
			// Afficher tout les messages de la salle
			client.lrange(`messages:${socket.channel}`, 0, 10, (err, messagesData) => {
				console.log(messagesData);
				socket.emit('channel.initMessages', messagesData);
			});
			
			// Afficher tout les utilisateurs de la salle
			client.smembers(`users:${socket.channel}`, (err, usersData) => {
				console.log(usersData);
				io.in(socket.channel).emit('channel.initUsers', usersData);
			});
			
			socket.emit('channel.initName', channel);
		});
	});
	
	// Créer une salle
	socket.on('channel.create', (channel) => {

		client.sadd('channels', channel);
		
		// Récupéré la liste des salles
		client.smembers('channels', (err, channels) => {
			console.log(channels);
			io.emit('chat.channelList', channels);
		});
		
		// Quitter la salle et entré dans la nouvelle
		socket.leave(socket.channel, () => {
			socket.join(channel);
			consoleLog('chatroom', 'joinChannel', `${socket.username} leave channel "${socket.channel}" and join channel "${channel}".`);
			
			socket.channel = channel;
			
			// Ajouter l'utilisateur à la liste de la salle
			client.sadd(`users:${socket.channel}`, socket.username);
			
			// Mettre son nom dans la liste des utilisateurs
			client.smembers(`users:${socket.channel}`, (err, usersData) => {
				console.log(usersData);
				socket.emit('channel.initUsers', usersData);
			});
			
			socket.emit('channel.initName', channel);
		});
	});
	
	// Afficher l'information qu'un utilisateur est entrain d'écrire
	socket.on('channel.userIsTyping', () => {
		socket.to(socket.channel).emit('channel.userIsTyping', socket.username);    
	});
	
	// ping
	socket.on('chat.ping', () => {
		socket.emit('chat.ping');
	});
	
	// Gérer les déconnections
	socket.on('disconnect', () => {
		consoleLog('socket', 'disconnect', ('[' + socket.username + ']').bold + ' socket closed');
		
		// Retirer l'utilisateur de la salle
		if(socket.username) client.srem(`users:${socket.channel}`, socket.username);
		
		// Retirer l'utilisateur de la liste connecté
		if (socket.username) client.srem("users", socket.username);
		
		// Ajouter l'utilisateur de la liste des déconnectés
		if (socket.username) client.sadd('disconnectedUsers', socket.username);
		
		client.smembers('disconnectedUsers', (err, data) =>{
			socket.broadcast.emit("chat.disconnectedUserList", data);
		});
		
		client.smembers('users', (err, data) =>{
			socket.broadcast.emit("chat.userList", data);
		});
	});
});

http.listen(3000, () => console.log('Listening on ' + 'http://localhost:3000\n'.green));
