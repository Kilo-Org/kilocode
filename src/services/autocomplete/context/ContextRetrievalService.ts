//PLANREF: continue/core/autocomplete/context/ContextRetrievalService.ts
import { IDE } from "../utils/ide"

import { ImportDefinitionsService } from "./ImportDefinitionsService"

export class ContextRetrievalService {
	private importDefinitionsService: ImportDefinitionsService

	constructor(private readonly ide: IDE) {
		this.importDefinitionsService = new ImportDefinitionsService(this.ide)
	}
}
