import React from "react"
import { motion, AnimatePresence } from "framer-motion"

interface AnimatedTabContainerProps {
	children: React.ReactNode
	tabKey: string
	className?: string
}

const fadeVariants = {
	initial: {
		opacity: 0,
	},
	animate: {
		opacity: 1,
	},
	exit: {
		opacity: 0,
	},
}

const transition = {
	duration: 0.1,
	ease: "easeOut",
}

export const AnimatedTabContainer: React.FC<AnimatedTabContainerProps> = ({ children, tabKey, className = "" }) => {
	return (
		<AnimatePresence mode="wait" initial={false}>
			<motion.div
				key={tabKey}
				variants={fadeVariants}
				initial="initial"
				animate="animate"
				exit="exit"
				transition={transition}
				className={className}>
				{children}
			</motion.div>
		</AnimatePresence>
	)
}
