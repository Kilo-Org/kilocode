/* eslint-disable react/jsx-no-target-blank */

"use client"

import Link from "next/link"
import Image from "next/image"
import { useState } from "react"
import { RxGithubLogo } from "react-icons/rx"
import { VscVscode } from "react-icons/vsc"
import { HiMenu } from "react-icons/hi"

import { EXTERNAL_LINKS } from "@/lib/constants"
import { useLogoSrc } from "@/lib/hooks/use-logo-src"
import { ScrollButton } from "@/components/ui"
import ThemeToggle from "@/components/chromes/theme-toggle"
import { Brain, Cloud, Puzzle, Slack, X } from "lucide-react"
import {
	NavigationMenu,
	NavigationMenuContent,
	NavigationMenuItem,
	NavigationMenuLink,
	NavigationMenuList,
	NavigationMenuTrigger,
	navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu"
import { cn } from "@/lib/utils"

function LinearIcon({ className }: { className?: string }) {
	return (
		<svg className={className} viewBox="0 0 100 100" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
			<path d="M1.22541 61.5228c-.2225-.9485.90748-1.5459 1.59638-.857L39.3342 97.1782c.6889.6889.0915 1.8189-.857 1.5964C20.0515 94.4522 5.54779 79.9485 1.22541 61.5228ZM.00189135 46.8891c-.01764375.2833.08887215.5599.28957165.7606L52.3503 99.7085c.2007.2007.4773.3075.7606.2896 2.3692-.1476 4.6938-.46 6.9624-.9259.7645-.157 1.0301-1.0963.4782-1.6481L2.57595 39.4485c-.55186-.5519-1.49117-.2863-1.648174.4782-.465915 2.2686-.77832 4.5932-.92588465 6.9624ZM4.21093 29.7054c-.16649.3738-.08169.8106.20765 1.1l64.77602 64.776c.2894.2894.7262.3742 1.1.2077 1.7861-.7956 3.5171-1.6927 5.1855-2.684.5521-.328.6373-1.0867.1832-1.5407L8.43566 24.3367c-.45409-.4541-1.21271-.3689-1.54074.1832-.99132 1.6684-1.88843 3.3994-2.68399 5.1855ZM12.6587 18.074c-.3701-.3701-.393-.9637-.0443-1.3541C21.7795 6.45931 35.1114 0 49.9519 0 77.5927 0 100 22.4073 100 50.0481c0 14.8405-6.4593 28.1724-16.7199 37.3375-.3903.3487-.984.3258-1.3542-.0443L12.6587 18.074Z" />
		</svg>
	)
}

interface NavBarProps {
	stars: string | null
	downloads: string | null
}

export function NavBar({ stars, downloads }: NavBarProps) {
	const [isMenuOpen, setIsMenuOpen] = useState(false)
	const logoSrc = useLogoSrc()

	return (
		<header className="sticky font-light top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
			<div className="container flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
				<div className="flex items-center flex-shrink-0">
					<Link href="/" className="flex items-center">
						<Image src={logoSrc} alt="Roo Code Logo" width={130} height={24} className="h-[24px] w-auto" />
					</Link>
				</div>

				{/* Desktop Navigation */}
				<NavigationMenu className="grow ml-6 hidden text-sm md:flex">
					<NavigationMenuList>
						{/* Product Dropdown */}
						<NavigationMenuItem>
							<NavigationMenuTrigger className="bg-transparent font-light">Product</NavigationMenuTrigger>
							<NavigationMenuContent>
								<ul className="grid min-w-[260px] gap-1 p-2">
									<li>
										<NavigationMenuLink asChild>
											<Link
												href="/extension"
												className="flex items-center select-none rounded-md px-3 py-2 text-sm leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground">
												<Puzzle className="size-3 mr-2" />
												Roo Code VS Code Extension
											</Link>
										</NavigationMenuLink>
									</li>
									<li>
										<NavigationMenuLink asChild>
											<Link
												href="/cloud"
												className="flex items-center select-none rounded-md px-3 py-2 text-sm leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground">
												<Cloud className="size-3 mr-2" />
												Roo Code Cloud
											</Link>
										</NavigationMenuLink>
									</li>
									<li>
										<NavigationMenuLink asChild>
											<Link
												href="/slack"
												className="flex items-center select-none rounded-md px-3 py-2 text-sm leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground">
												<Slack className="size-3 mr-2" />
												Roo Code for Slack
											</Link>
										</NavigationMenuLink>
									</li>
									<li>
										<NavigationMenuLink asChild>
											<Link
												href="/linear"
												className="flex items-center select-none rounded-md px-3 py-2 text-sm leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground">
												<LinearIcon className="size-3 mr-2" />
												Roo Code for Linear
											</Link>
										</NavigationMenuLink>
									</li>
									<li>
										<NavigationMenuLink asChild>
											<Link
												href="/provider"
												className="flex items-center select-none rounded-md px-3 py-2 text-sm leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground">
												<Brain className="size-3 mr-2" />
												Roo Code Router
											</Link>
										</NavigationMenuLink>
									</li>
								</ul>
							</NavigationMenuContent>
						</NavigationMenuItem>

						{/* Resources Dropdown */}
						<NavigationMenuItem>
							<NavigationMenuTrigger className="bg-transparent font-light">
								Resources
							</NavigationMenuTrigger>
							<NavigationMenuContent>
								<ul className="grid min-w-[260px] gap-1 p-2">
									<li>
										<NavigationMenuLink asChild>
											<Link
												href="/evals"
												className="block select-none rounded-md px-3 py-2 text-sm leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground">
												Evals
											</Link>
										</NavigationMenuLink>
									</li>
									<li>
										<NavigationMenuLink asChild>
											<a
												href={EXTERNAL_LINKS.DISCORD}
												target="_blank"
												rel="noopener noreferrer"
												className="block select-none rounded-md px-3 py-2 text-sm leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground">
												Discord
											</a>
										</NavigationMenuLink>
									</li>
									<li>
										<NavigationMenuLink asChild>
											<a
												href={EXTERNAL_LINKS.SECURITY}
												target="_blank"
												rel="noopener noreferrer"
												className="block select-none rounded-md px-3 py-2 text-sm leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground">
												Trust Center
											</a>
										</NavigationMenuLink>
									</li>
								</ul>
							</NavigationMenuContent>
						</NavigationMenuItem>

						{/* Docs Link */}
						<NavigationMenuItem>
							<NavigationMenuLink
								asChild
								className={cn(navigationMenuTriggerStyle(), "bg-transparent font-light")}>
								<a href={EXTERNAL_LINKS.DOCUMENTATION} target="_blank">
									Docs
								</a>
							</NavigationMenuLink>
						</NavigationMenuItem>

						{/* Pricing Link */}
						<NavigationMenuItem>
							<NavigationMenuLink
								asChild
								className={cn(navigationMenuTriggerStyle(), "bg-transparent font-light")}>
								<Link href="/pricing">Pricing</Link>
							</NavigationMenuLink>
						</NavigationMenuItem>
					</NavigationMenuList>
				</NavigationMenu>

				<div className="hidden md:flex md:items-center md:space-x-4 flex-shrink-0 font-medium">
					<div className="flex flex-row space-x-2 flex-shrink-0">
						<ThemeToggle />
						<Link
							href={EXTERNAL_LINKS.GITHUB}
							target="_blank"
							className="hidden items-center gap-1.5 text-sm hover:text-foreground md:flex whitespace-nowrap">
							<RxGithubLogo className="h-4 w-4" />
							{stars !== null && <span>{stars}</span>}
						</Link>
					</div>
					<a
						href={EXTERNAL_LINKS.CLOUD_APP_LOGIN}
						target="_blank"
						rel="noopener noreferrer"
						className="hidden items-center gap-1.5 rounded-md py-2 text-sm border border-primary-background px-4 text-primary-background transition-all duration-200 hover:shadow-lg hover:scale-105 lg:flex">
						Log in
					</a>
					<a
						href={EXTERNAL_LINKS.CLOUD_APP_SIGNUP_HOME}
						target="_blank"
						rel="noopener noreferrer"
						className="hidden items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground transition-all duration-200 hover:shadow-lg hover:scale-105 md:flex">
						Sign Up
					</a>
					<Link
						href={EXTERNAL_LINKS.MARKETPLACE}
						target="_blank"
						className="hidden items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground transition-all duration-200 hover:shadow-lg hover:scale-105 md:flex whitespace-nowrap">
						<VscVscode className="-mr-[2px] mt-[1px] h-4 w-4" />
						<span>
							Install <span className="font-black max-lg:text-xs">&middot;</span>
						</span>
						{downloads !== null && <span>{downloads}</span>}
					</Link>
				</div>

				{/* Mobile Menu Button */}
				<button
					aria-expanded={isMenuOpen}
					onClick={() => setIsMenuOpen(!isMenuOpen)}
					className="relative z-10 flex items-center justify-center rounded-full p-2 transition-colors hover:bg-accent md:hidden"
					aria-label="Toggle mobile menu">
					<HiMenu className={`h-6 w-6 ${isMenuOpen ? "hidden" : "block"}`} />
					<X className={`h-6 w-6 ${isMenuOpen ? "block" : "hidden"}`} />
				</button>
			</div>

			{/* Mobile Menu Panel - Full Screen */}
			<div
				className={`fixed top-16 left-0 bg-background right-0 z-[100] transition-all duration-200 pointer-events-none md:hidden ${isMenuOpen ? "block h-dvh" : "hidden"}`}>
				<nav className="flex flex-col justify-between h-full pb-16 overflow-y-auto bg-background pointer-events-auto">
					{/* Main navigation items */}
					<div className="grow-1 py-4 font-semibold text-lg">
						<a
							href={EXTERNAL_LINKS.DOCUMENTATION}
							target="_blank"
							className="block w-full p-5 text-left text-foreground active:opacity-50"
							onClick={() => setIsMenuOpen(false)}>
							Docs
						</a>
						<Link
							href="/pricing"
							className="block w-full p-5 text-left text-foreground active:opacity-50"
							onClick={() => setIsMenuOpen(false)}>
							Pricing
						</Link>

						{/* Product Section */}
						<div className="mt-4 w-full">
							<div className="px-5 pb-2 pt-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
								Product
							</div>
							<Link
								href="/extension"
								className="block w-full p-5 py-3 text-left text-foreground active:opacity-50"
								onClick={() => setIsMenuOpen(false)}>
								Roo Code VS Code Extension
							</Link>
							<Link
								href="/cloud"
								className="block w-full p-5 py-3 text-left text-foreground active:opacity-50"
								onClick={() => setIsMenuOpen(false)}>
								Roo Code Cloud
							</Link>
							<Link
								href="/slack"
								className="block w-full p-5 py-3 text-left text-foreground active:opacity-50"
								onClick={() => setIsMenuOpen(false)}>
								Roo Code for Slack
							</Link>
							<Link
								href="/linear"
								className="block w-full p-5 py-3 text-left text-foreground active:opacity-50"
								onClick={() => setIsMenuOpen(false)}>
								Roo Code for Linear
							</Link>
							<Link
								href="/provider"
								className="block w-full p-5 py-3 text-left text-foreground active:opacity-50"
								onClick={() => setIsMenuOpen(false)}>
								Roo Code Router
							</Link>
						</div>

						{/* Resources Section */}
						<div className="mt-4 w-full">
							<div className="px-5 pb-2 pt-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
								Resources
							</div>
							<ScrollButton
								targetId="faq"
								className="block w-full p-5 py-3 text-left text-foreground active:opacity-50"
								onClick={() => setIsMenuOpen(false)}>
								FAQ
							</ScrollButton>
							<Link
								href="/evals"
								className="block w-full p-5 py-3 text-left text-foreground active:opacity-50"
								onClick={() => setIsMenuOpen(false)}>
								Evals
							</Link>
							<a
								href={EXTERNAL_LINKS.DISCORD}
								target="_blank"
								rel="noopener noreferrer"
								className="block w-full p-5 py-3 text-left text-foreground active:opacity-50"
								onClick={() => setIsMenuOpen(false)}>
								Discord
							</a>
							<a
								href={EXTERNAL_LINKS.SECURITY}
								target="_blank"
								rel="noopener noreferrer"
								className="block w-full p-5 py-3 text-left text-foreground active:opacity-50"
								onClick={() => setIsMenuOpen(false)}>
								Security Center
							</a>
						</div>
					</div>

					{/* Bottom section with Cloud Login and stats */}
					<div className="border-t border-border">
						<div className="flex items-center justify-around px-6 pt-2">
							<Link
								href={EXTERNAL_LINKS.GITHUB}
								target="_blank"
								className="inline-flex items-center gap-2 rounded-md p-3 text-sm transition-colors hover:bg-accent hover:text-foreground"
								onClick={() => setIsMenuOpen(false)}>
								<RxGithubLogo className="h-6 w-6" />
								{stars !== null && <span>{stars}</span>}
							</Link>
							<div className="flex items-center rounded-md p-3 transition-colors hover:bg-accent">
								<ThemeToggle />
							</div>
							<Link
								href={EXTERNAL_LINKS.MARKETPLACE}
								target="_blank"
								className="inline-flex items-center gap-2 rounded-md p-3 text-sm transition-colors hover:bg-accent hover:text-foreground"
								onClick={() => setIsMenuOpen(false)}>
								<VscVscode className="h-6 w-6" />
								{downloads !== null && <span>{downloads}</span>}
							</Link>
						</div>
						<div className="flex gap-2 px-4 pb-4">
							<a
								href={EXTERNAL_LINKS.CLOUD_APP_SIGNUP_HOME}
								target="_blank"
								rel="noopener noreferrer"
								className="flex items-center justify-center gap-2 rounded-full border border-primary bg-foreground p-4 w-full text-base font-semibold text-background"
								onClick={() => setIsMenuOpen(false)}>
								Sign up
							</a>
							<a
								href={EXTERNAL_LINKS.CLOUD_APP_LOGIN}
								target="_blank"
								rel="noopener noreferrer"
								className="flex items-center justify-center gap-2 rounded-full border border-primary bg-background p-4 w-full text-base font-semibold text-primary"
								onClick={() => setIsMenuOpen(false)}>
								Log in
							</a>
						</div>
					</div>
				</nav>
			</div>
		</header>
	)
}
