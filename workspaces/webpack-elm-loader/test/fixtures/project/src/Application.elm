module Application exposing (main)

import Browser
import Browser.Navigation as Navigation
import Html
import Url


main : Program () Navigation.Key ()
main =
    Browser.application
        { init = \_ _ key -> ( key, Cmd.none )
        , view = \_ -> { title = "Application", body = [ Html.text "Hello from an application" ] }
        , update = \_ key -> ( key, Cmd.none )
        , subscriptions = \_ -> Sub.none
        , onUrlRequest = \_ -> ()
        , onUrlChange = \_ -> ()
        }
