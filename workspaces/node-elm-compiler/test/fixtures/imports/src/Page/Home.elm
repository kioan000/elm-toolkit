port module Page.Home exposing (view)

import Api
import Html exposing (Html)
import Ui.Button


view : Html msg
view =
    Ui.Button.primary Api.endpoint
