import React, { useState, useEffect, useRef, useCallback } from "react"
import { View, Text, FlatList, KeyboardAvoidingView, Platform, TouchableWithoutFeedback } from "react-native"
import { useFocusEffect } from "@react-navigation/native"
import PinnedMessage from "./PinnedMessage"
import ChatInput from "./ChatInput"
import ChatRow from "./ChatRow"
import { useTheme } from "../hooks/useTheme"
import { getChatViewStyles } from "../styles/components"
import { getModeStyles } from "../styles/theme"
import { config } from "../config"
import MatrixBackground from "./MatrixBackground"
import ArchitectureBackground from "./ArchitectureBackground"
import DefaultBackground from "./DefaultBackground"
import { startNewTask, sendFollowup, cancelTask, getTaskHistory, setMode as setApiMode } from "../services/api"

const backgroundMap = {
	code: <MatrixBackground />,
	architect: <ArchitectureBackground />,
};

const ChatView = ({ route }) => {
	const [messages, setMessages] = useState([])
	const [inputValue, setInputValue] = useState("")
	const [isStreaming, setIsStreaming] = useState(false)
	const [currentTaskId, setCurrentTaskId] = useState(null)
	const [pinnedMessage, setPinnedMessage] = useState("")
	const [mode, setMode] = useState("architect")
	const { theme, setExpandedMessageId } = useTheme()
	const styles = getChatViewStyles(theme)
	const flatListRef = useRef(null)
	const inputRef = useRef(null)

	const modeStyles = getModeStyles(theme)
	const activeModeStyle = modeStyles[mode] || modeStyles.architect

	useFocusEffect(
		useCallback(() => {
			const { task } = route.params || {}
			console.log("ChatView focused with task:", task)

			if (task) {
				console.log("Loading history for taskId:", task.id)
				setCurrentTaskId(task.id)
				setPinnedMessage(task.task)
				setMode(task.mode)
				getTaskHistory(task.id).then((data) => {
					if (data) {
						console.log("History data received:", data)
						setMessages(data)
					}
				})
			} else {
				console.log("New chat session.")
				setMessages([])
				setCurrentTaskId(null)
				setPinnedMessage("")
				setMode("architect")
			}
		}, [route.params?.task]),
	)

	const onMessage = useCallback((newMessage) => {
		if (newMessage.type === "ask" && newMessage.ask === "tool") {
			try {
				const tool = JSON.parse(newMessage.text)
				if (tool.tool === "switchMode" && tool.mode) {
					setMode(tool.mode)
				}
			} catch (e) {
				console.error("Error parsing tool message:", e)
			}
		}

		setMessages((prevMessages) => {
			const newMessages = [...prevMessages]
			const lastMessage = newMessages[newMessages.length - 1]

			if (lastMessage && lastMessage.sender !== "user" && lastMessage.ts === newMessage.ts) {
				// Update last message if it's a partial from the same stream
				newMessages[newMessages.length - 1] = { ...lastMessage, ...newMessage }
			} else {
				// Add new message
				newMessages.push(newMessage)
			}
			return newMessages
		})
	}, [])

	const onError = (error) => {
		console.error("Streaming error:", error)
		setIsStreaming(false)
	}

	const onComplete = () => {
		setIsStreaming(false)
	}

	const handleSend = async () => {
		if (!inputValue.trim()) return

		await setApiMode(mode)

		const userMessage = {
			ts: Date.now(),
			type: "say",
			say: "text",
			text: inputValue,
			sender: "user",
		}
		setMessages((prev) => [...prev, userMessage])
		setInputValue("")
		setIsStreaming(true)

		setPinnedMessage(inputValue)

		const onTaskId = (taskId) => {
			console.log("onTaskId callback received taskId:", taskId)
			setCurrentTaskId(taskId)
		}

		if (currentTaskId) {
			sendFollowup(currentTaskId, inputValue, onMessage, onError, onComplete)
		} else {
			startNewTask(inputValue, onMessage, onError, onComplete, onTaskId)
		}
	}

	const handleCancel = () => {
		cancelTask(currentTaskId)
		setIsStreaming(false)
	}

	const BackgroundComponent = backgroundMap[mode] || <DefaultBackground />

	const onSuggestionPress = useCallback((suggestion) => {
		setInputValue(suggestion)
	}, []);

	const renderItem = useCallback(({ item }) => (
		<ChatRow
			item={item}
			onSuggestionPress={onSuggestionPress}
		/>
	), [onSuggestionPress]);

	return (
		<View style={[styles.container, { fontFamily: activeModeStyle.font }]}>
			{BackgroundComponent}
			<PinnedMessage message={pinnedMessage} />
			<KeyboardAvoidingView
				style={{ flex: 1 }}
				behavior={Platform.OS === "ios" ? "padding" : undefined}
				keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}>
				<FlatList
					ref={flatListRef}
					data={messages}
					keyExtractor={(item, index) => `${item.ts}-${index}`}
					renderItem={renderItem}
					onScrollBeginDrag={() => setExpandedMessageId(null)}
					contentContainerStyle={{ padding: 10, paddingBottom: 150 }}
					showsVerticalScrollIndicator={true}
				/>
			</KeyboardAvoidingView>

			<View style={styles.inputContainer}>
				<ChatInput
					inputValue={inputValue}
					setInputValue={setInputValue}
					isStreaming={isStreaming}
					handleSend={handleSend}
					handleCancel={handleCancel}
					mode={mode}
					onModeChange={setMode}
					inputRef={inputRef}
				/>
			</View>
		</View>
	)
}

export default ChatView
